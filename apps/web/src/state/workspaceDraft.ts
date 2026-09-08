import type {
  EditableParameters,
  HardwarePreference,
  ModelId,
  OutputConflictGroup,
  OutputPolicy,
  ProfileMode,
  SubtitleParameters,
  TranscriptionDraft,
} from '../contracts/desktop';
import { getPreset } from '../data/presets';
import { getSubtitlePreset } from '../data/subtitlePresets';
import { DEFAULT_HARDWARE_PREFERENCE } from './hardware';
import {
  DEFAULT_RECOGNITION_STRATEGY,
  normalizePromptText,
  translationTaskSupported,
} from './parameterProfiles';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function outputConflictDetails(
  error: unknown,
): { paths: string[]; conflicts: OutputConflictGroup[]; mediaPaths: string[] } | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as {
    code?: unknown;
    paths?: unknown;
    conflicts?: unknown;
    mediaPaths?: unknown;
  };
  if (candidate.code !== 'output.conflict' || !Array.isArray(candidate.paths)) return null;
  const paths = candidate.paths.filter((item): item is string => typeof item === 'string');
  if (paths.length === 0) return null;
  const conflicts = Array.isArray(candidate.conflicts)
    ? candidate.conflicts
        .filter(
          (item): item is { inputPath: string; paths: string[] } =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as { inputPath?: unknown }).inputPath === 'string' &&
            Array.isArray((item as { paths?: unknown }).paths),
        )
        .map((item) => ({
          inputPath: item.inputPath,
          paths: item.paths.filter((path): path is string => typeof path === 'string'),
        }))
    : [];
  const mediaPaths = Array.isArray(candidate.mediaPaths)
    ? candidate.mediaPaths.filter((item): item is string => typeof item === 'string')
    : [];
  return { paths, conflicts, mediaPaths };
}

export function isAllOutputsSkipped(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'output.all_skipped'
  );
}

export function subtitleOverridesFor(draft: TranscriptionDraft): Partial<SubtitleParameters> {
  const defaults = getSubtitlePreset(draft.basePresetId).subtitleParameters;
  return Object.fromEntries(
    Object.entries(draft.subtitleParameters).filter(
      ([key, value]) => defaults[key as keyof SubtitleParameters] !== value,
    ),
  ) as Partial<SubtitleParameters>;
}

export function normalizeDraft(draft: TranscriptionDraft): TranscriptionDraft {
  const legacy = draft as TranscriptionDraft & {
    modelId?: ModelId;
    profileMode?: ProfileMode;
    subtitleParameters?: SubtitleParameters;
    hardware?: HardwarePreference;
    output: OutputPolicy & { srtEnabled?: boolean; preserveSourceMarkdown?: boolean };
  };
  const modelId = legacy.modelId ?? 'large-v3-turbo';
  const baseParameters = getPreset(draft.basePresetId, modelId).parameters;
  return {
    ...structuredClone(draft),
    modelId,
    recognitionStrategy: DEFAULT_RECOGNITION_STRATEGY,
    hardware: legacy.hardware ?? { ...DEFAULT_HARDWARE_PREFERENCE },
    profileMode: legacy.profileMode ?? 'transcript',
    effectiveParameters: { ...baseParameters, ...draft.effectiveParameters },
    subtitleParameters: {
      ...getSubtitlePreset(draft.basePresetId).subtitleParameters,
      ...legacy.subtitleParameters,
    },
    output: {
      ...draft.output,
      srtEnabled: legacy.output.srtEnabled ?? false,
      preserveSourceMarkdown: legacy.output.preserveSourceMarkdown ?? false,
      conflictPolicy:
        legacy.output.conflictPolicy === 'auto_rename'
          ? 'auto_rename'
          : legacy.output.conflictPolicy === 'confirm_skip'
            ? 'confirm_skip'
            : 'confirm_overwrite',
    },
  };
}

export function normalizedTaskOverrides(
  overrides: Partial<EditableParameters>,
): Partial<EditableParameters> {
  const normalized = { ...overrides };
  for (const key of ['initial_prompt', 'hotwords'] as const) {
    const value = normalized[key];
    if (typeof value !== 'string') continue;
    const text = normalizePromptText(value).trim();
    if (text.length === 0) delete normalized[key];
    else normalized[key] = text;
  }
  return normalized;
}

export function draftHasUnsupportedTranslation(draft: TranscriptionDraft): boolean {
  const task = draft.overrides.task ?? draft.effectiveParameters.task;
  return task === 'translate' && !translationTaskSupported(draft.modelId, draft.basePresetId);
}

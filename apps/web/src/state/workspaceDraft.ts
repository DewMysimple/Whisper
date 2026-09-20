import type {
  EditableParameters,
  InputSource,
  ModelId,
  OutputConflictGroup,
  OutputPolicy,
  ProfileMode,
  SubtitleParameters,
  TranscriptionDraft,
} from '../contracts/desktop';
import { DEFAULT_MODEL_ID } from '../contracts/desktop';
import { getPreset } from '../data/presets';
import { getSubtitlePreset } from '../data/subtitlePresets';
import {
  DEFAULT_RECOGNITION_STRATEGY,
  normalizePromptText,
  translationTaskSupported,
} from './parameterProfiles';

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.message === 'string' && candidate.message.trim() !== '') {
      return candidate.message;
    }
    if (typeof candidate.error === 'string' && candidate.error.trim() !== '') {
      return candidate.error;
    }
    if (typeof candidate.code === 'string' && candidate.code.trim() !== '') {
      return candidate.code;
    }
    return '桌面操作失败。';
  }
  return String(error);
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
    output: OutputPolicy & { srtEnabled?: boolean; preserveSourceMarkdown?: boolean };
  };
  const modelId = legacy.modelId ?? DEFAULT_MODEL_ID;
  const baseParameters = getPreset(draft.basePresetId, modelId).parameters;
  const normalized = structuredClone(draft) as TranscriptionDraft & { hardware?: unknown };
  delete normalized.hardware;
  return {
    ...normalized,
    modelId,
    recognitionStrategy: DEFAULT_RECOGNITION_STRATEGY,
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
  for (const key of ['initial_prompt', 'hotwords', 'prefix'] as const) {
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

export function isCustomTaskDraft(draft: TranscriptionDraft): boolean {
  if (Object.keys(draft.overrides).length > 0) return true;
  if (!draft.output.srtEnabled) return false;
  const defaults = getSubtitlePreset(draft.basePresetId).subtitleParameters;
  return (Object.keys(defaults) as Array<keyof SubtitleParameters>).some(
    (key) =>
      draft.subtitleParameters?.[key] !== undefined &&
      draft.subtitleParameters[key] !== defaults[key],
  );
}

export function mergeUniqueInputs(existing: InputSource[], incoming: InputSource[]): InputSource[] {
  const keys = new Set(existing.map((item) => item.path.toLocaleLowerCase()));
  return [
    ...existing,
    ...incoming.filter((item) => {
      const key = item.path.toLocaleLowerCase();
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    }),
  ];
}

import type {
  EditableParameters,
  HardwarePreference,
  ModelId,
  OutputPolicy,
  ProfileMode,
  PresetId,
  RecognitionStrategy,
  SubtitleParameters,
  TaskSnapshot,
} from '../contracts/desktop';
import {
  DEFAULT_MODEL_ID,
  MODEL_IDS,
  PRESET_IDS,
  SECONDARY_RECOGNITION_MODEL_IDS,
} from '../contracts/desktop';
import { getPreset } from '../data/presets';
import { getSubtitlePreset } from '../data/subtitlePresets';
import { DEFAULT_HARDWARE_PREFERENCE } from './hardware';
import {
  isV3ModelId,
  parameterProfileKey,
  parseParameterProfileKey,
  sanitizeProfileOverrides,
  DEFAULT_RECOGNITION_STRATEGY,
  translationTaskSupported,
  type ParameterProfiles,
  type RecognitionStrategyProfiles,
} from './parameterProfiles';
import {
  DEFAULT_APPEARANCE,
  LOG_FONT_SIZE_RANGE,
  UI_FONT_SIZE_RANGE,
  normalizeHexColor,
  type AccentPreset,
  type AppearancePreferences,
  type MonoFontFamily,
  type ThemePreference,
  type UiFontFamily,
} from './appearancePreferences';

export {
  DEFAULT_APPEARANCE,
  LOG_FONT_SIZE_RANGE,
  UI_FONT_SIZE_RANGE,
  applyAppearancePreferences,
  applyThemePreference,
  normalizeHexColor,
} from './appearancePreferences';
export type {
  AccentPreset,
  MonoFontFamily,
  ThemePreference,
  UiFontFamily,
} from './appearancePreferences';

export interface WorkspacePreferences extends AppearancePreferences {
  selectedModelId: ModelId;
  hardwarePreference: HardwarePreference;
  selectedPresetId: PresetId;
  profileMode: ProfileMode;
  parameters: EditableParameters;
  overrides: Partial<EditableParameters>;
  parameterProfiles: ParameterProfiles;
  recognitionStrategy: RecognitionStrategy;
  recognitionStrategyProfiles: RecognitionStrategyProfiles;
  subtitleParameters: SubtitleParameters;
  subtitleOverrides: Partial<SubtitleParameters>;
  output: OutputPolicy;
}

interface PersistedWorkspace {
  schemaVersion: 1;
  preferences: WorkspacePreferences;
  tasks: TaskSnapshot[];
}

const STORAGE_KEY = 'whisper-subtitle.desktop-state.v1';
const TASK_LIMIT = 100;

export function loadWorkspaceState(): PersistedWorkspace | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.schemaVersion !== 1) return null;
    if (!Array.isArray(value.tasks) || !value.tasks.every(isTaskSnapshot)) return null;
    const preferences = parsePreferences(value.preferences);
    if (preferences === null) return null;
    return {
      schemaVersion: 1,
      preferences,
      tasks: value.tasks.slice(0, TASK_LIMIT).map(normalizeTaskSnapshot).map(markInterruptedTask),
    };
  } catch {
    return null;
  }
}

export function saveWorkspaceState(preferences: WorkspacePreferences, tasks: TaskSnapshot[]): void {
  const payload: PersistedWorkspace = {
    schemaVersion: 1,
    preferences,
    tasks: tasks.slice(0, TASK_LIMIT),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function exportPreferences(preferences: WorkspacePreferences): string {
  return JSON.stringify({ schemaVersion: 1, preferences }, null, 2);
}

export function importPreferences(text: string): WorkspacePreferences {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('配置版本无效，只支持 schemaVersion 1。');
  }
  const preferences = parsePreferences(value.preferences);
  if (preferences === null) throw new Error('配置字段或参数范围无效。');
  return preferences;
}

function markInterruptedTask(task: TaskSnapshot): TaskSnapshot {
  if (task.status !== 'queued' && task.status !== 'running') return task;
  return {
    ...task,
    status: 'failed',
    stage: '上次桌面会话已中断',
    errorCode: 'host.session_interrupted',
    completedAt: new Date().toISOString(),
  };
}

function parsePreferences(value: unknown): WorkspacePreferences | null {
  if (!isRecord(value)) return null;
  if (!isTheme(value.theme) || !isPreset(value.selectedPresetId)) return null;
  const legacyContentFontSize = value.contentFontSize;
  const uiFontSize =
    value.uiFontSize ??
    (legacyContentFontSize === 'small'
      ? 12
      : legacyContentFontSize === 'large'
        ? 16
        : DEFAULT_APPEARANCE.uiFontSize);
  const logFontSize = value.logFontSize ?? DEFAULT_APPEARANCE.logFontSize;
  const accentPreset = value.accentPreset ?? DEFAULT_APPEARANCE.accentPreset;
  const customAccentColor = value.customAccentColor ?? DEFAULT_APPEARANCE.customAccentColor;
  const uiFontFamily = value.uiFontFamily ?? DEFAULT_APPEARANCE.uiFontFamily;
  const monoFontFamily = value.monoFontFamily ?? DEFAULT_APPEARANCE.monoFontFamily;
  const requestedModelId = value.selectedModelId ?? DEFAULT_MODEL_ID;
  const hardwarePreference = value.hardwarePreference ?? DEFAULT_HARDWARE_PREFERENCE;
  if (
    !isNumberInRange(uiFontSize, UI_FONT_SIZE_RANGE.minimum, UI_FONT_SIZE_RANGE.maximum, true) ||
    !isNumberInRange(logFontSize, LOG_FONT_SIZE_RANGE.minimum, LOG_FONT_SIZE_RANGE.maximum, true) ||
    !isAccentPreset(accentPreset) ||
    typeof customAccentColor !== 'string' ||
    normalizeHexColor(customAccentColor) === null ||
    !isUiFontFamily(uiFontFamily) ||
    !isMonoFontFamily(monoFontFamily) ||
    !isModelId(requestedModelId) ||
    !isHardwarePreference(hardwarePreference)
  ) {
    return null;
  }
  const selectedModelId = isV3ModelId(requestedModelId) ? requestedModelId : DEFAULT_MODEL_ID;
  const profileMode = value.profileMode ?? 'transcript';
  if (profileMode !== 'transcript' && profileMode !== 'subtitle') return null;
  if (!isOverrides(value.overrides)) return null;
  const parsedProfiles = parseParameterProfiles(value.parameterProfiles);
  if (parsedProfiles === null) return null;
  let parameterProfiles = parsedProfiles;
  const currentProfileKey = parameterProfileKey(selectedModelId, value.selectedPresetId);
  if (value.parameterProfiles === undefined && Object.keys(value.overrides).length > 0) {
    parameterProfiles = {
      [currentProfileKey]: sanitizeProfileOverrides(
        selectedModelId,
        value.selectedPresetId,
        value.overrides,
      ),
    };
  }
  const currentOverrides = parameterProfiles[currentProfileKey] ?? {};
  const parsedRecognitionProfiles = parseRecognitionStrategyProfiles(
    value.recognitionStrategyProfiles,
  );
  if (parsedRecognitionProfiles === null) return null;
  const parameterValue = isRecord(value.parameters) ? value.parameters : {};
  const importedParameterSnapshot = {
    ...getPreset(value.selectedPresetId, selectedModelId).parameters,
    ...parameterValue,
  };
  if (
    importedParameterSnapshot.task === 'translate' &&
    !translationTaskSupported(selectedModelId, value.selectedPresetId)
  ) {
    importedParameterSnapshot.task = 'transcribe';
  }
  if (!isParameters(importedParameterSnapshot)) return null;
  const parameters = {
    ...getPreset(value.selectedPresetId, selectedModelId).parameters,
    ...(value.parameterProfiles === undefined ? importedParameterSnapshot : {}),
    ...currentOverrides,
  };
  if (!isParameters(parameters)) return null;
  const subtitleValue = isRecord(value.subtitleParameters) ? value.subtitleParameters : {};
  const subtitleOverrides = value.subtitleOverrides ?? {};
  if (!isSubtitleOverrides(subtitleOverrides)) return null;
  const subtitlePresetParameters = getSubtitlePreset(value.selectedPresetId).subtitleParameters;
  const subtitleParameters = {
    ...subtitlePresetParameters,
    ...subtitleValue,
    // Version-one state used to persist the old default (2) as a full object.
    // Only retain it when the user explicitly customized this field.
    max_lines_per_cue:
      'max_lines_per_cue' in subtitleOverrides
        ? subtitleOverrides.max_lines_per_cue!
        : subtitlePresetParameters.max_lines_per_cue,
  };
  if (!isSubtitleParameters(subtitleParameters)) {
    return null;
  }
  if (!isRecord(value.output)) return null;
  const output = {
    ...value.output,
    srtEnabled: value.output.srtEnabled ?? false,
    preserveSourceMarkdown: value.output.preserveSourceMarkdown ?? false,
    conflictPolicy:
      value.output.conflictPolicy === 'auto_rename'
        ? 'auto_rename'
        : value.output.conflictPolicy === 'confirm_skip'
          ? 'confirm_skip'
          : 'confirm_overwrite',
  };
  if (!isOutputPolicy(output)) return null;
  return {
    theme: value.theme,
    accentPreset,
    customAccentColor: normalizeHexColor(customAccentColor)!,
    uiFontSize,
    logFontSize,
    uiFontFamily,
    monoFontFamily,
    selectedModelId,
    hardwarePreference,
    selectedPresetId: value.selectedPresetId,
    profileMode,
    parameters,
    overrides: currentOverrides,
    parameterProfiles,
    recognitionStrategy: DEFAULT_RECOGNITION_STRATEGY,
    recognitionStrategyProfiles: {},
    subtitleParameters,
    subtitleOverrides,
    output,
  };
}

function isTaskSnapshot(value: unknown): value is TaskSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.sourceCount === 'number' &&
    isPreset(value.presetId) &&
    typeof value.isCustom === 'boolean' &&
    ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(String(value.status)) &&
    typeof value.progress === 'number' &&
    typeof value.stage === 'string' &&
    typeof value.elapsed === 'string' &&
    typeof value.createdAt === 'string'
  );
}

function normalizeTaskSnapshot(task: TaskSnapshot): TaskSnapshot {
  const legacy = task as TaskSnapshot & { modelId?: ModelId; draft?: TaskSnapshot['draft'] };
  return {
    ...task,
    modelId: isModelId(legacy.modelId) ? legacy.modelId : DEFAULT_MODEL_ID,
    recognitionStrategy:
      (task.recognitionStrategy === 'mixed_zh_en' ||
        task.recognitionStrategy === 'zh_detail_review') &&
      ['cn', 'cn2'].includes(task.presetId) &&
      SECONDARY_RECOGNITION_MODEL_IDS.includes(
        (isModelId(legacy.modelId)
          ? legacy.modelId
          : DEFAULT_MODEL_ID) as (typeof SECONDARY_RECOGNITION_MODEL_IDS)[number],
      )
        ? task.recognitionStrategy
        : 'stable_primary',
    draft:
      legacy.draft === undefined
        ? undefined
        : {
            ...legacy.draft,
            modelId: isModelId(legacy.draft.modelId) ? legacy.draft.modelId : DEFAULT_MODEL_ID,
            recognitionStrategy:
              (legacy.draft.recognitionStrategy === 'mixed_zh_en' ||
                legacy.draft.recognitionStrategy === 'zh_detail_review') &&
              ['cn', 'cn2'].includes(legacy.draft.basePresetId) &&
              SECONDARY_RECOGNITION_MODEL_IDS.includes(
                (isModelId(legacy.draft.modelId)
                  ? legacy.draft.modelId
                  : DEFAULT_MODEL_ID) as (typeof SECONDARY_RECOGNITION_MODEL_IDS)[number],
              )
                ? legacy.draft.recognitionStrategy
                : 'stable_primary',
            hardware: isHardwarePreference(legacy.draft.hardware)
              ? legacy.draft.hardware
              : DEFAULT_HARDWARE_PREFERENCE,
            output: {
              ...legacy.draft.output,
              conflictPolicy:
                legacy.draft.output.conflictPolicy === 'auto_rename'
                  ? 'auto_rename'
                  : legacy.draft.output.conflictPolicy === 'confirm_skip'
                    ? 'confirm_skip'
                    : 'confirm_overwrite',
            },
          },
  };
}

function isHardwarePreference(value: unknown): value is HardwarePreference {
  if (!isRecord(value)) return false;
  return (
    (value.mode === 'auto' || value.mode === 'cuda' || value.mode === 'cpu') &&
    isNumberInRange(value.gpuDeviceIndex, 0, 31, true) &&
    ['float16', 'int8_float16', 'float32'].includes(String(value.cudaComputeType)) &&
    (value.cpuComputeType === 'int8' || value.cpuComputeType === 'float32') &&
    isNumberInRange(value.cpuThreads, 1, 256, true)
  );
}

function isParameters(value: unknown): value is EditableParameters {
  if (!isRecord(value)) return false;
  return (
    (value.task === 'transcribe' || value.task === 'translate') &&
    isNumberInRange(value.beam_size, 1, 20, true) &&
    isNumberInRange(value.best_of, 1, 20, true) &&
    isNumberInRange(value.patience, 0, 5) &&
    isNumberInRange(value.length_penalty, 0, 2) &&
    isNumberInRange(value.temperature, 0, 1) &&
    isNumberInRange(value.repetition_penalty, 1, 2) &&
    isNumberInRange(value.no_repeat_ngram_size, 0, 10, true) &&
    isNumberInRange(value.compression_ratio_threshold, 0, 10) &&
    isNumberInRange(value.log_prob_threshold, -10, 0) &&
    isNumberInRange(value.no_speech_threshold, 0, 1) &&
    typeof value.condition_on_previous_text === 'boolean' &&
    isNumberInRange(value.prompt_reset_on_temperature, 0, 1) &&
    isPromptText(value.initial_prompt) &&
    isPromptText(value.hotwords) &&
    isNumberInRange(value.min_silence_duration_ms, 0, 10000, true)
  );
}

function isOverrides(value: unknown): value is Partial<EditableParameters> {
  if (!isRecord(value)) return false;
  const allowed = new Set([
    'task',
    'beam_size',
    'best_of',
    'patience',
    'length_penalty',
    'temperature',
    'repetition_penalty',
    'no_repeat_ngram_size',
    'compression_ratio_threshold',
    'log_prob_threshold',
    'no_speech_threshold',
    'condition_on_previous_text',
    'prompt_reset_on_temperature',
    'initial_prompt',
    'hotwords',
    'min_silence_duration_ms',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  return Object.entries(value).every(([key, item]) => {
    if (key === 'task') return item === 'transcribe' || item === 'translate';
    if (key === 'initial_prompt' || key === 'hotwords') return isPromptText(item);
    if (key === 'condition_on_previous_text') return typeof item === 'boolean';
    if (key === 'beam_size' || key === 'best_of') return isNumberInRange(item, 1, 20, true);
    if (key === 'patience') return isNumberInRange(item, 0, 5);
    if (key === 'length_penalty') return isNumberInRange(item, 0, 2);
    if (key === 'repetition_penalty') return isNumberInRange(item, 1, 2);
    if (key === 'no_repeat_ngram_size') return isNumberInRange(item, 0, 10, true);
    if (key === 'compression_ratio_threshold') return isNumberInRange(item, 0, 10);
    if (key === 'log_prob_threshold') return isNumberInRange(item, -10, 0);
    if (key === 'min_silence_duration_ms') return isNumberInRange(item, 0, 10000, true);
    return isNumberInRange(item, 0, 1);
  });
}

function parseParameterProfiles(value: unknown): ParameterProfiles | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const profiles: ParameterProfiles = {};
  for (const [key, overrides] of Object.entries(value)) {
    const parsedKey = parseParameterProfileKey(key);
    if (parsedKey === null) return null;
    if (!isOverrides(overrides)) return null;
    const [modelId, presetId] = parsedKey;
    profiles[parameterProfileKey(modelId, presetId)] = sanitizeProfileOverrides(
      modelId,
      presetId,
      overrides,
    );
  }
  return profiles;
}

function parseRecognitionStrategyProfiles(value: unknown): RecognitionStrategyProfiles | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  for (const [key, strategy] of Object.entries(value)) {
    if (parseParameterProfileKey(key) === null) return null;
    if (
      strategy !== 'mixed_zh_en' &&
      strategy !== 'zh_detail_review' &&
      strategy !== 'stable_primary'
    )
      return null;
  }
  return {};
}

function isPromptText(value: unknown): value is string {
  if (typeof value !== 'string' || Array.from(value).length > 4000) return false;
  return Array.from(value).every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return character === '\n' || character === '\t' || code >= 0x20;
  });
}

function isSubtitleParameters(value: unknown): value is SubtitleParameters {
  if (!isRecord(value)) return false;
  return (
    isNumberInRange(value.max_characters_per_line, 8, 84, true) &&
    isNumberInRange(value.max_lines_per_cue, 1, 3, true) &&
    isNumberInRange(value.min_cue_duration_ms, 250, 5000, true) &&
    isNumberInRange(value.max_cue_duration_ms, 1000, 15000, true) &&
    value.min_cue_duration_ms <= value.max_cue_duration_ms &&
    isNumberInRange(value.max_characters_per_second, 5, 40) &&
    isNumberInRange(value.cue_gap_ms, 0, 1000, true)
  );
}

function isSubtitleOverrides(value: unknown): value is Partial<SubtitleParameters> {
  if (!isRecord(value)) return false;
  const allowed = new Set([
    'max_characters_per_line',
    'max_lines_per_cue',
    'min_cue_duration_ms',
    'max_cue_duration_ms',
    'max_characters_per_second',
    'cue_gap_ms',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  return Object.entries(value).every(([key, item]) => {
    if (key === 'max_characters_per_line') return isNumberInRange(item, 8, 84, true);
    if (key === 'max_lines_per_cue') return isNumberInRange(item, 1, 3, true);
    if (key === 'min_cue_duration_ms') return isNumberInRange(item, 250, 5000, true);
    if (key === 'max_cue_duration_ms') return isNumberInRange(item, 1000, 15000, true);
    if (key === 'max_characters_per_second') return isNumberInRange(item, 5, 40);
    return isNumberInRange(item, 0, 1000, true);
  });
}

function isOutputPolicy(value: unknown): value is OutputPolicy {
  if (!isRecord(value)) return false;
  return (
    (value.mode === 'compatibility' || value.mode === 'custom') &&
    (value.rootDirectory === null || typeof value.rootDirectory === 'string') &&
    typeof value.txtEnabled === 'boolean' &&
    typeof value.markdownEnabled === 'boolean' &&
    typeof value.srtEnabled === 'boolean' &&
    (value.txtEnabled || value.markdownEnabled || value.srtEnabled) &&
    typeof value.preserveSourceTxt === 'boolean' &&
    typeof value.preserveSourceMarkdown === 'boolean' &&
    (value.conflictPolicy === 'confirm_overwrite' ||
      value.conflictPolicy === 'confirm_skip' ||
      value.conflictPolicy === 'auto_rename')
  );
}

function isNumberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  integer = false,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum &&
    (!integer || Number.isInteger(value))
  );
}

function isPreset(value: unknown): value is PresetId {
  return typeof value === 'string' && PRESET_IDS.includes(value as PresetId);
}

function isModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && MODEL_IDS.includes(value as ModelId);
}

function isTheme(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system';
}

function isAccentPreset(value: unknown): value is AccentPreset {
  return ['orange', 'blue', 'green', 'purple', 'custom'].includes(String(value));
}

function isUiFontFamily(value: unknown): value is UiFontFamily {
  return ['system', 'segoe-variable', 'microsoft-yahei-ui', 'noto-sans-sc', 'dengxian'].includes(
    String(value),
  );
}

function isMonoFontFamily(value: unknown): value is MonoFontFamily {
  return ['cascadia-mono', 'cascadia-code', 'consolas'].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

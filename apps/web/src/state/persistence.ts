import { isParameters, isParameterOverrides as isOverrides } from './parameterValidation';
import { isExecutionOptions } from './executionOptions';
import type {
  EditableParameters,
  ExecutionOptions,
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
import {
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
  SIDEBAR_WIDTH_RANGE,
  UI_FONT_SIZE_RANGE,
  WORKSPACE_FONT_SIZE_RANGE,
  WORKSPACE_WIDTH_RANGE,
  TOPBAR_HEIGHT_RANGE,
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
  SIDEBAR_WIDTH_RANGE,
  UI_FONT_SIZE_RANGE,
  WORKSPACE_FONT_SIZE_RANGE,
  WORKSPACE_WIDTH_RANGE,
  TOPBAR_HEIGHT_RANGE,
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
  executionOptions?: ExecutionOptions;
  selectedModelId: ModelId;
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

export function loadWorkspaceState(storageKey = STORAGE_KEY): PersistedWorkspace | null {
  try {
    const raw = localStorage.getItem(storageKey);
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

export function saveWorkspaceState(
  preferences: WorkspacePreferences,
  tasks: TaskSnapshot[],
  storageKey = STORAGE_KEY,
): void {
  const payload: PersistedWorkspace = {
    schemaVersion: 1,
    preferences,
    tasks: tasks.slice(0, TASK_LIMIT),
  };
  localStorage.setItem(storageKey, JSON.stringify(payload));
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
  const executionOptions = value.executionOptions ?? {};
  if (!isExecutionOptions(executionOptions)) return null;
  if (!isTheme(value.theme) || !isPreset(value.selectedPresetId)) return null;
  const legacyContentFontSize = value.contentFontSize;
  const uiFontSize = value.uiFontSize ?? DEFAULT_APPEARANCE.uiFontSize;
  const workspaceFontSize =
    value.workspaceFontSize ??
    (legacyContentFontSize === 'small'
      ? 12
      : legacyContentFontSize === 'large'
        ? 16
        : legacyContentFontSize === 'balanced'
          ? 14
          : (value.uiFontSize ?? DEFAULT_APPEARANCE.workspaceFontSize));
  const logFontSize = value.logFontSize ?? DEFAULT_APPEARANCE.logFontSize;
  const sidebarWidth = value.sidebarWidth ?? DEFAULT_APPEARANCE.sidebarWidth;
  const workspaceWidth = value.workspaceWidth ?? DEFAULT_APPEARANCE.workspaceWidth;
  const topbarCollapsed = value.topbarCollapsed ?? DEFAULT_APPEARANCE.topbarCollapsed;
  const topbarHeight = value.topbarHeight ?? DEFAULT_APPEARANCE.topbarHeight;
  const accentPreset = value.accentPreset ?? DEFAULT_APPEARANCE.accentPreset;
  const customAccentColor = value.customAccentColor ?? DEFAULT_APPEARANCE.customAccentColor;
  const uiFontFamily = value.uiFontFamily ?? DEFAULT_APPEARANCE.uiFontFamily;
  const monoFontFamily = value.monoFontFamily ?? DEFAULT_APPEARANCE.monoFontFamily;
  const requestedModelId = value.selectedModelId ?? DEFAULT_MODEL_ID;
  if (
    typeof topbarCollapsed !== 'boolean' ||
    !isNumberInRange(uiFontSize, UI_FONT_SIZE_RANGE.minimum, UI_FONT_SIZE_RANGE.maximum, true) ||
    !isNumberInRange(
      workspaceFontSize,
      WORKSPACE_FONT_SIZE_RANGE.minimum,
      WORKSPACE_FONT_SIZE_RANGE.maximum,
      true,
    ) ||
    !isNumberInRange(logFontSize, LOG_FONT_SIZE_RANGE.minimum, LOG_FONT_SIZE_RANGE.maximum, true) ||
    !isNumberInRange(
      sidebarWidth,
      SIDEBAR_WIDTH_RANGE.minimum,
      SIDEBAR_WIDTH_RANGE.maximum,
      true,
    ) ||
    !isNumberInRange(
      workspaceWidth,
      WORKSPACE_WIDTH_RANGE.minimum,
      WORKSPACE_WIDTH_RANGE.maximum,
      true,
    ) ||
    !isNumberInRange(
      topbarHeight,
      TOPBAR_HEIGHT_RANGE.minimum,
      TOPBAR_HEIGHT_RANGE.maximum,
      true,
    ) ||
    !isAccentPreset(accentPreset) ||
    typeof customAccentColor !== 'string' ||
    normalizeHexColor(customAccentColor) === null ||
    !isUiFontFamily(uiFontFamily) ||
    !isMonoFontFamily(monoFontFamily) ||
    !isModelId(requestedModelId)
  ) {
    return null;
  }
  const selectedModelId = requestedModelId;
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
    executionOptions: { ...executionOptions },
    accentPreset,
    customAccentColor: normalizeHexColor(customAccentColor)!,
    uiFontSize,
    workspaceFontSize,
    logFontSize,
    uiFontFamily,
    monoFontFamily,
    sidebarWidth,
    workspaceWidth,
    topbarHeight,
    topbarCollapsed,
    selectedModelId,
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
  const normalizedDraft =
    legacy.draft === undefined
      ? undefined
      : ({ ...legacy.draft } as NonNullable<TaskSnapshot['draft']> & { hardware?: unknown });
  if (normalizedDraft !== undefined) delete normalizedDraft.hardware;
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
      normalizedDraft === undefined
        ? undefined
        : {
            ...normalizedDraft,
            execution: isExecutionOptions(normalizedDraft.execution)
              ? { ...normalizedDraft.execution }
              : undefined,
            modelId: isModelId(normalizedDraft.modelId)
              ? normalizedDraft.modelId
              : DEFAULT_MODEL_ID,
            recognitionStrategy:
              (normalizedDraft.recognitionStrategy === 'mixed_zh_en' ||
                normalizedDraft.recognitionStrategy === 'zh_detail_review') &&
              ['cn', 'cn2'].includes(normalizedDraft.basePresetId) &&
              SECONDARY_RECOGNITION_MODEL_IDS.includes(
                (isModelId(normalizedDraft.modelId)
                  ? normalizedDraft.modelId
                  : DEFAULT_MODEL_ID) as (typeof SECONDARY_RECOGNITION_MODEL_IDS)[number],
              )
                ? normalizedDraft.recognitionStrategy
                : 'stable_primary',
            output: {
              ...normalizedDraft.output,
              conflictPolicy:
                normalizedDraft.output.conflictPolicy === 'auto_rename'
                  ? 'auto_rename'
                  : normalizedDraft.output.conflictPolicy === 'confirm_skip'
                    ? 'confirm_skip'
                    : 'confirm_overwrite',
            },
          },
  };
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

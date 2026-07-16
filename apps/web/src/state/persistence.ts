import type {
  EditableParameters,
  OutputPolicy,
  PresetId,
  TaskSnapshot,
} from '../contracts/desktop';
import { PRESET_IDS } from '../contracts/desktop';

export type ThemePreference = 'dark' | 'light' | 'system';

export interface WorkspacePreferences {
  theme: ThemePreference;
  selectedPresetId: PresetId;
  parameters: EditableParameters;
  overrides: Partial<EditableParameters>;
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
      tasks: value.tasks.slice(0, TASK_LIMIT).map(markInterruptedTask),
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

export function applyThemePreference(theme: ThemePreference): void {
  const resolved =
    theme === 'system'
      ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false)
        ? 'light'
        : 'dark'
      : theme;
  document.documentElement.dataset.theme = resolved;
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
  if (!isParameters(value.parameters) || !isOverrides(value.overrides)) return null;
  if (!isOutputPolicy(value.output)) return null;
  return {
    theme: value.theme,
    selectedPresetId: value.selectedPresetId,
    parameters: value.parameters,
    overrides: value.overrides,
    output: value.output,
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

function isParameters(value: unknown): value is EditableParameters {
  if (!isRecord(value)) return false;
  return (
    isNumberInRange(value.beam_size, 1, 20, true) &&
    isNumberInRange(value.best_of, 1, 20, true) &&
    isNumberInRange(value.patience, 0, 5) &&
    isNumberInRange(value.temperature, 0, 1) &&
    isNumberInRange(value.no_speech_threshold, 0, 1) &&
    typeof value.condition_on_previous_text === 'boolean'
  );
}

function isOverrides(value: unknown): value is Partial<EditableParameters> {
  if (!isRecord(value)) return false;
  const allowed = new Set([
    'beam_size',
    'best_of',
    'patience',
    'temperature',
    'no_speech_threshold',
    'condition_on_previous_text',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  return Object.entries(value).every(([key, item]) => {
    if (key === 'condition_on_previous_text') return typeof item === 'boolean';
    if (key === 'beam_size' || key === 'best_of') return isNumberInRange(item, 1, 20, true);
    if (key === 'patience') return isNumberInRange(item, 0, 5);
    return isNumberInRange(item, 0, 1);
  });
}

function isOutputPolicy(value: unknown): value is OutputPolicy {
  if (!isRecord(value)) return false;
  return (
    (value.mode === 'compatibility' || value.mode === 'custom') &&
    (value.rootDirectory === null || typeof value.rootDirectory === 'string') &&
    typeof value.txtEnabled === 'boolean' &&
    typeof value.markdownEnabled === 'boolean' &&
    (value.txtEnabled || value.markdownEnabled) &&
    typeof value.preserveSourceTxt === 'boolean' &&
    (value.conflictPolicy === 'fail' || value.conflictPolicy === 'auto_rename')
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

function isTheme(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

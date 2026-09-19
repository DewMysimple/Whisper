import { desktopBridge } from '../bridge';
import type { WorkspaceState } from './workspace';
import {
  applyAppearancePreferences,
  saveWorkspaceState,
  type WorkspacePreferences,
} from './persistence';
import { DEFAULT_RECOGNITION_STRATEGY } from './parameterProfiles';

export function preferencesFromState(state: WorkspaceState): WorkspacePreferences {
  return {
    theme: state.theme,
    accentPreset: state.accentPreset,
    customAccentColor: state.customAccentColor,
    uiFontSize: state.uiFontSize,
    workspaceFontSize: state.workspaceFontSize,
    logFontSize: state.logFontSize,
    uiFontFamily: state.uiFontFamily,
    monoFontFamily: state.monoFontFamily,
    sidebarWidth: state.sidebarWidth,
    workspaceWidth: state.workspaceWidth,
    topbarHeight: state.topbarHeight,
    selectedModelId: state.selectedModelId,
    selectedPresetId: state.selectedPresetId,
    profileMode: state.profileMode,
    parameters: state.parameters,
    overrides: state.overrides,
    parameterProfiles: state.parameterProfiles,
    recognitionStrategy: DEFAULT_RECOGNITION_STRATEGY,
    recognitionStrategyProfiles: {},
    subtitleParameters: state.subtitleParameters,
    subtitleOverrides: state.subtitleOverrides,
    output: state.output,
  };
}

export function appearanceFromState(
  state: Pick<
    WorkspaceState,
    | 'theme'
    | 'accentPreset'
    | 'customAccentColor'
    | 'uiFontSize'
    | 'workspaceFontSize'
    | 'logFontSize'
    | 'uiFontFamily'
    | 'monoFontFamily'
    | 'sidebarWidth'
    | 'workspaceWidth'
    | 'topbarHeight'
  >,
) {
  return {
    theme: state.theme,
    accentPreset: state.accentPreset,
    customAccentColor: state.customAccentColor,
    uiFontSize: state.uiFontSize,
    workspaceFontSize: state.workspaceFontSize,
    logFontSize: state.logFontSize,
    uiFontFamily: state.uiFontFamily,
    monoFontFamily: state.monoFontFamily,
    sidebarWidth: state.sidebarWidth,
    workspaceWidth: state.workspaceWidth,
    topbarHeight: state.topbarHeight,
  };
}

let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
let pendingState: (() => WorkspaceState) | undefined;

export function flushPersistence(): void {
  if (persistenceTimer !== undefined) clearTimeout(persistenceTimer);
  persistenceTimer = undefined;
  const get = pendingState;
  pendingState = undefined;
  if (!get) return;
  try {
    const state = get();
    saveWorkspaceState(preferencesFromState(state), state.tasks);
  } catch {
    get().handleEvent({
      type: 'worker.error',
      code: 'storage.write_failed',
      message: '本机配置与任务历史保存失败，请检查存储空间。当前会话仍保留记录。',
    });
  }
}

export function persistLater(get: () => WorkspaceState): void {
  if (desktopBridge.mode !== 'tauri') return;
  pendingState = get;
  // Throttle rather than debounce: continuous progress must still reach storage.
  persistenceTimer ??= setTimeout(flushPersistence, 150);
}

export { applyAppearancePreferences };

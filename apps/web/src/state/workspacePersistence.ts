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
    logFontSize: state.logFontSize,
    uiFontFamily: state.uiFontFamily,
    monoFontFamily: state.monoFontFamily,
    selectedModelId: state.selectedModelId,
    hardwarePreference: state.hardwarePreference,
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
    | 'logFontSize'
    | 'uiFontFamily'
    | 'monoFontFamily'
  >,
) {
  return {
    theme: state.theme,
    accentPreset: state.accentPreset,
    customAccentColor: state.customAccentColor,
    uiFontSize: state.uiFontSize,
    logFontSize: state.logFontSize,
    uiFontFamily: state.uiFontFamily,
    monoFontFamily: state.monoFontFamily,
  };
}

let persistenceTimer: ReturnType<typeof setTimeout> | undefined;

export function persistLater(get: () => WorkspaceState): void {
  if (desktopBridge.mode !== 'tauri') return;
  if (persistenceTimer !== undefined) clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(() => {
    const state = get();
    saveWorkspaceState(preferencesFromState(state), state.tasks);
  }, 150);
}

export { applyAppearancePreferences };

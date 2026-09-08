import { create } from 'zustand';

import { desktopBridge } from '../bridge';
import type {
  DesktopEvent,
  EditableParameters,
  FinishAction,
  HardwarePreference,
  HostStatus,
  InputSource,
  LocalModelDescriptor,
  ModelId,
  ModelStatus,
  OutputPreview,
  OutputConflictGroup,
  OutputPolicy,
  PerformanceSample,
  PowerActionStatus,
  PowerCapabilities,
  ProfileMode,
  PresetId,
  RecognitionStrategy,
  SubtitleParameters,
  TaskSnapshot,
  TaskStatus,
  TranscriptionDraft,
  WorkerEnvironment,
} from '../contracts/desktop';
import { getPreset } from '../data/presets';
import { getSubtitlePreset } from '../data/subtitlePresets';
import {
  applyAppearancePreferences,
  DEFAULT_APPEARANCE,
  exportPreferences,
  importPreferences,
  loadWorkspaceState,
  normalizeHexColor,
  type AccentPreset,
  type MonoFontFamily,
  type ThemePreference,
  type UiFontFamily,
} from './persistence';
import {
  DEFAULT_RECOGNITION_STRATEGY,
  normalizePromptText,
  profileOverrides,
  profileParameters,
  translationTaskSupported,
  withProfileOverrides,
  type ParameterProfiles,
  type RecognitionStrategyProfiles,
} from './parameterProfiles';
import {
  DEFAULT_HARDWARE_PREFERENCE,
  hardwarePreferenceSupported,
  recommendedHardwarePreference,
} from './hardware';
import { parseWindowsClipboardPaths } from './clipboardPaths';
import type { TaskDateRange } from './taskHistory';
import { handleWorkspaceEvent } from './workspaceEvents';
import { activeTaskId, canResumeTask, isAbnormalTask, taskOutputPaths } from './workspaceTaskState';
import {
  draftHasUnsupportedTranslation,
  errorMessage,
  isAllOutputsSkipped,
  normalizeDraft,
  normalizedTaskOverrides,
  outputConflictDetails,
  subtitleOverridesFor,
} from './workspaceDraft';
import { appearanceFromState, persistLater, preferencesFromState } from './workspacePersistence';

export { canResumeTask, isAbnormalTask } from './workspaceTaskState';

const INITIAL_PERFORMANCE: PerformanceSample = {
  source: desktopBridge.mode === 'mock' ? 'mock' : 'worker',
  gpu: desktopBridge.mode === 'mock' ? 74 : null,
  vramUsed: desktopBridge.mode === 'mock' ? 8.1 : null,
  vramTotal: desktopBridge.mode === 'mock' ? 16 : null,
  cpu: desktopBridge.mode === 'mock' ? 26 : null,
  memory: desktopBridge.mode === 'mock' ? 44 : null,
  speed: desktopBridge.mode === 'mock' ? 4.8 : null,
  memoryUsed: desktopBridge.mode === 'mock' ? 13.4 : null,
  memoryTotal: desktopBridge.mode === 'mock' ? 32 : null,
  memoryAvailable: desktopBridge.mode === 'mock' ? 18.6 : null,
  swapUsed: desktopBridge.mode === 'mock' ? 0.2 : null,
  swapTotal: desktopBridge.mode === 'mock' ? 32 : null,
  workerRss: desktopBridge.mode === 'mock' ? 0.42 : null,
  workerThreadCount: desktopBridge.mode === 'mock' ? 18 : null,
  workerHandleCount: desktopBridge.mode === 'mock' ? 264 : null,
  cpuName: desktopBridge.mode === 'mock' ? 'Intel(R) Core(TM) i7-14700KF' : null,
  cpuFrequencyMhz: desktopBridge.mode === 'mock' ? 5200 : null,
  cpuPhysicalCores: desktopBridge.mode === 'mock' ? 20 : null,
  cpuLogicalCores: desktopBridge.mode === 'mock' ? 28 : null,
  systemProcessCount: desktopBridge.mode === 'mock' ? 278 : null,
  systemUptimeSeconds: desktopBridge.mode === 'mock' ? 16315 : null,
  gpuName: desktopBridge.mode === 'mock' ? 'RTX 5070 Ti' : null,
  gpuMemoryController: desktopBridge.mode === 'mock' ? 34 : null,
  gpuTemperature: desktopBridge.mode === 'mock' ? 44 : null,
  gpuClockMhz: desktopBridge.mode === 'mock' ? 2670 : null,
  gpuMemoryClockMhz: desktopBridge.mode === 'mock' ? 14001 : null,
  gpuPowerWatts: desktopBridge.mode === 'mock' ? 126 : null,
  gpuPowerLimitWatts: desktopBridge.mode === 'mock' ? 300 : null,
  gpuFanPercent: desktopBridge.mode === 'mock' ? 42 : null,
  gpuDriverVersion: desktopBridge.mode === 'mock' ? '610.62' : null,
  gpuPerformanceState: desktopBridge.mode === 'mock' ? 'P2' : null,
  timestamp: Date.now(),
};

const INITIAL_TASKS: TaskSnapshot[] = [
  {
    id: 'mock-task-1',
    title: '设计评审会议.m4a',
    sourceCount: 2,
    presetId: 'cn2',
    modelId: 'large-v3-turbo',
    isCustom: false,
    status: 'running',
    progress: 63,
    stage: 'GPU 转录中',
    elapsed: '03:18',
    createdAt: '2026-07-22T21:42:00+08:00',
    draft: {
      inputs: [
        {
          id: 'mock-active-source-1',
          path: 'D:\\会议素材\\设计评审会议.m4a',
          kind: 'file',
          origin: 'dialog',
          valid: true,
          mediaCount: 1,
        },
        {
          id: 'mock-active-source-2',
          path: 'D:\\会议素材\\设计评审补充.wav',
          kind: 'file',
          origin: 'dialog',
          valid: true,
          mediaCount: 1,
        },
      ],
      modelId: 'large-v3-turbo',
      basePresetId: 'cn2',
      profileMode: 'transcript',
      overrides: {},
      effectiveParameters: { ...getPreset('cn2').parameters },
      subtitleParameters: { ...getSubtitlePreset('cn2').subtitleParameters },
      output: {
        mode: 'compatibility',
        rootDirectory: null,
        txtEnabled: true,
        markdownEnabled: true,
        srtEnabled: false,
        preserveSourceTxt: false,
        preserveSourceMarkdown: false,
        conflictPolicy: 'confirm_overwrite',
      },
      hardware: { ...DEFAULT_HARDWARE_PREFERENCE },
    },
  },
  {
    id: 'mock-task-2',
    title: 'Product Interview 06.mkv',
    sourceCount: 1,
    presetId: 'en_v1',
    modelId: 'large-v3-turbo',
    isCustom: true,
    status: 'completed',
    progress: 100,
    stage: '已生成 TXT',
    elapsed: '05:24',
    createdAt: '2026-07-21T21:30:00+08:00',
    outputs: ['D:\\Mock\\Product Interview 06.txt'],
    draft: {
      inputs: [
        {
          id: 'mock-history-source',
          path: 'D:\\素材\\Product Interview 06.mkv',
          kind: 'file',
          origin: 'dialog',
          valid: true,
          mediaCount: 1,
        },
      ],
      modelId: 'large-v3-turbo',
      basePresetId: 'en_v1',
      profileMode: 'transcript',
      overrides: {},
      effectiveParameters: { ...getPreset('en_v1').parameters },
      subtitleParameters: { ...getSubtitlePreset('en_v1').subtitleParameters },
      output: {
        mode: 'compatibility',
        rootDirectory: null,
        txtEnabled: true,
        markdownEnabled: false,
        srtEnabled: false,
        preserveSourceTxt: false,
        preserveSourceMarkdown: false,
        conflictPolicy: 'confirm_overwrite',
      },
      hardware: { ...DEFAULT_HARDWARE_PREFERENCE },
    },
  },
];

export type TaskFilter = 'all' | TaskStatus;
export type TaskWorkspaceMode = 'monitor' | 'history';
export type WorkspaceViewId =
  'workspace' | 'models' | 'hardware' | 'performance' | 'tasks' | 'logs' | 'settings';
export type ModelWorkspaceTab = 'library' | 'parameters';

export interface PendingOverwrite {
  draft: TranscriptionDraft;
  paths: string[];
  conflicts: OutputConflictGroup[];
  mediaPaths: string[];
  mode: 'overwrite' | 'skip';
  finishAction: FinishAction;
  source: 'workspace' | 'resume';
}

export interface PendingShutdownStart {
  draft: TranscriptionDraft;
}

export interface WorkspaceState {
  inputs: InputSource[];
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
  tasks: TaskSnapshot[];
  performance: PerformanceSample;
  performanceHistory: PerformanceSample[];
  hostStatus: HostStatus;
  environment: WorkerEnvironment | null;
  model: ModelStatus;
  localModels: LocalModelDescriptor[];
  modelsLoading: boolean;
  modelSwitching: boolean;
  pendingModelId: ModelId | null;
  pendingHardware: boolean;
  pendingOverwrite: PendingOverwrite | null;
  pendingShutdownStart: PendingShutdownStart | null;
  finishAction: FinishAction;
  powerCapabilities: PowerCapabilities;
  powerActionStatus: PowerActionStatus;
  shutdownArmed: boolean;
  logs: string[];
  lastError: string | null;
  startingTask: boolean;
  activeView: WorkspaceViewId;
  modelWorkspaceTab: ModelWorkspaceTab;
  theme: ThemePreference;
  accentPreset: AccentPreset;
  customAccentColor: string;
  uiFontSize: number;
  logFontSize: number;
  uiFontFamily: UiFontFamily;
  monoFontFamily: MonoFontFamily;
  selectedTaskId: string | null;
  outputPreview: OutputPreview | null;
  previewLoading: boolean;
  outputAuditPending: boolean;
  taskFilter: TaskFilter;
  taskSearch: string;
  taskDateRange: TaskDateRange | null;
  taskWorkspaceMode: TaskWorkspaceMode;
  monitoredTaskId: string | null;
  configText: string;
  initialized: boolean;
  setActiveView(view: WorkspaceState['activeView']): void;
  setModelWorkspaceTab(tab: ModelWorkspaceTab): void;
  refreshModels(): Promise<void>;
  openModelDirectory(): Promise<void>;
  selectModel(modelId: ModelId): Promise<void>;
  setHardwarePreference(preference: HardwarePreference): Promise<void>;
  restoreHardwareDefaults(): Promise<void>;
  confirmOverwrite(): Promise<void>;
  cancelOverwrite(): void;
  confirmShutdownStart(): Promise<void>;
  cancelShutdownStart(): void;
  setFinishAction(action: FinishAction): void;
  cancelPowerAction(): Promise<void>;
  setTheme(theme: ThemePreference): void;
  setAccentPreset(preset: AccentPreset): void;
  setCustomAccentColor(color: string): void;
  setUiFontSize(size: number): void;
  setLogFontSize(size: number): void;
  setUiFontFamily(family: UiFontFamily): void;
  setMonoFontFamily(family: MonoFontFamily): void;
  restoreAppearanceDefaults(): void;
  setTaskFilter(filter: TaskFilter): void;
  setTaskSearch(search: string): void;
  setTaskDateRange(range: TaskDateRange | null): void;
  setTaskWorkspaceMode(mode: TaskWorkspaceMode): void;
  addFiles(): Promise<void>;
  addDirectory(): Promise<void>;
  addClipboardPaths(): Promise<void>;
  chooseOutputDirectory(): Promise<void>;
  restoreDefaultOutputDirectory(): void;
  removeInput(id: string): void;
  clearInputs(): void;
  selectProfile(mode: ProfileMode, id: PresetId): void;
  setParameter<K extends keyof EditableParameters>(key: K, value: EditableParameters[K]): void;
  setTemperatureMode(mode: 'model' | 'fixed'): void;
  setSubtitleParameter<K extends keyof SubtitleParameters>(
    key: K,
    value: SubtitleParameters[K],
  ): void;
  restorePreset(): void;
  setOutput(patch: Partial<OutputPolicy>): void;
  startTask(): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  revealTaskOutput(taskId: string): Promise<void>;
  openTaskOutputDirectory(taskId: string): Promise<void>;
  auditTaskOutputs(): Promise<void>;
  selectTask(taskId: string | null): Promise<void>;
  retryTask(taskId: string): Promise<void>;
  resumeTask(taskId: string): Promise<void>;
  clearCompletedHistory(): void;
  clearAbnormalHistory(): void;
  deleteTaskHistory(taskId: string): void;
  exportConfig(): void;
  setConfigText(text: string): void;
  importConfig(): void;
  restartWorker(): Promise<void>;
  clearError(): void;
  handleEvent(event: DesktopEvent): void;
  initialize(): () => void;
}

function mergeUniqueInputs(existing: InputSource[], incoming: InputSource[]): InputSource[] {
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

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  inputs: [],
  selectedModelId: 'large-v3-turbo',
  hardwarePreference: { ...DEFAULT_HARDWARE_PREFERENCE },
  selectedPresetId: 'en_v1',
  profileMode: 'transcript',
  parameters: { ...getPreset('en_v1').parameters },
  overrides: {},
  parameterProfiles: {},
  recognitionStrategy: DEFAULT_RECOGNITION_STRATEGY,
  recognitionStrategyProfiles: {},
  subtitleParameters: { ...getSubtitlePreset('en_v1').subtitleParameters },
  subtitleOverrides: {},
  output: {
    mode: 'compatibility',
    rootDirectory: null,
    txtEnabled: true,
    markdownEnabled: false,
    srtEnabled: false,
    preserveSourceTxt: false,
    preserveSourceMarkdown: false,
    conflictPolicy: 'confirm_overwrite',
  },
  tasks: desktopBridge.mode === 'mock' ? INITIAL_TASKS : [],
  performance: INITIAL_PERFORMANCE,
  performanceHistory: [INITIAL_PERFORMANCE],
  hostStatus: {
    state: desktopBridge.mode === 'mock' ? 'ready' : 'starting',
    pid: desktopBridge.mode === 'mock' ? 4242 : null,
    launchKind: desktopBridge.mode,
    error: null,
  },
  environment: null,
  model: {
    state: 'unloaded',
    modelId: null,
    device: null,
    computeType: null,
    deviceIndex: null,
    cpuThreads: null,
  },
  localModels: [],
  modelsLoading: false,
  modelSwitching: false,
  pendingModelId: null,
  pendingHardware: false,
  pendingOverwrite: null,
  pendingShutdownStart: null,
  finishAction: 'none',
  powerCapabilities: { shutdown: false },
  powerActionStatus: {
    state: 'idle',
    action: null,
    executeAtEpochMs: null,
    error: null,
  },
  shutdownArmed: false,
  logs: [],
  lastError: null,
  startingTask: false,
  activeView: 'workspace',
  modelWorkspaceTab: 'library',
  ...DEFAULT_APPEARANCE,
  selectedTaskId: null,
  outputPreview: null,
  previewLoading: false,
  outputAuditPending: false,
  taskFilter: 'all',
  taskSearch: '',
  taskDateRange: null,
  taskWorkspaceMode: 'history',
  monitoredTaskId: desktopBridge.mode === 'mock' ? 'mock-task-1' : null,
  configText: '',
  initialized: false,

  setActiveView: (activeView) =>
    set((state) => ({
      activeView,
      modelWorkspaceTab: activeView === 'models' ? 'library' : state.modelWorkspaceTab,
      taskWorkspaceMode:
        activeView === 'tasks'
          ? state.tasks.some((task) => task.status === 'queued' || task.status === 'running')
            ? 'monitor'
            : state.monitoredTaskId !== null
              ? state.taskWorkspaceMode
              : 'history'
          : state.taskWorkspaceMode,
    })),
  setModelWorkspaceTab: (modelWorkspaceTab) => set({ modelWorkspaceTab }),
  setFinishAction: (finishAction) => set({ finishAction }),
  cancelPowerAction: async () => {
    try {
      const powerActionStatus = await desktopBridge.cancelPowerAction();
      set({ powerActionStatus, shutdownArmed: false, lastError: null });
    } catch (error) {
      set({ lastError: errorMessage(error) });
    }
  },
  refreshModels: async () => {
    set({ modelsLoading: true });
    try {
      const localModels = await desktopBridge.listLocalModels();
      set({ localModels, lastError: null });
    } catch (error) {
      set({ lastError: errorMessage(error) });
    } finally {
      set({ modelsLoading: false });
    }
  },
  openModelDirectory: async () => {
    try {
      await desktopBridge.openModelDirectory();
      set({ lastError: null });
    } catch (error) {
      set({ lastError: errorMessage(error) });
    }
  },
  selectModel: async (modelId) => {
    const state = get();
    const descriptor = state.localModels.find((item) => item.id === modelId);
    if (descriptor?.installed !== true) {
      set({ lastError: `模型 ${modelId} 尚未完整安装。`, activeView: 'models' });
      return;
    }
    const previous = state.selectedModelId;
    const busy = state.tasks.some((task) => task.status === 'queued' || task.status === 'running');
    if (busy) {
      set({ lastError: '任务执行或排队期间不能切换模型。', activeView: 'models' });
      return;
    }
    set({
      selectedModelId: modelId,
      parameters: profileParameters(state.parameterProfiles, modelId, state.selectedPresetId),
      overrides: profileOverrides(state.parameterProfiles, modelId, state.selectedPresetId),
      recognitionStrategy: DEFAULT_RECOGNITION_STRATEGY,
      pendingModelId: null,
      lastError: null,
    });
    persistLater(get);
    set({ modelSwitching: true });
    try {
      await desktopBridge.loadModel(modelId, state.hardwarePreference);
      set({ pendingModelId: null });
    } catch (error) {
      set({
        selectedModelId: previous,
        parameters: profileParameters(state.parameterProfiles, previous, state.selectedPresetId),
        overrides: profileOverrides(state.parameterProfiles, previous, state.selectedPresetId),
        recognitionStrategy: DEFAULT_RECOGNITION_STRATEGY,
        pendingModelId: null,
        lastError: errorMessage(error),
      });
      persistLater(get);
      if (
        previous !== modelId &&
        state.localModels.some((item) => item.id === previous && item.installed)
      ) {
        try {
          await desktopBridge.loadModel(previous, state.hardwarePreference);
        } catch {
          set({
            model: {
              state: 'unloaded',
              modelId: null,
              device: null,
              computeType: null,
              deviceIndex: null,
              cpuThreads: null,
            },
          });
        }
      }
    } finally {
      set({ modelSwitching: false });
    }
  },
  setHardwarePreference: async (hardwarePreference) => {
    const state = get();
    const capabilities = state.environment?.hardware;
    if (!hardwarePreferenceSupported(hardwarePreference, capabilities)) {
      set({ lastError: '当前本机不支持所选硬件配置。', activeView: 'hardware' });
      return;
    }
    const previous = state.hardwarePreference;
    const busy = state.tasks.some((task) => task.status === 'queued' || task.status === 'running');
    if (busy) {
      set({ lastError: '任务执行或排队期间不能更改硬件配置。', activeView: 'hardware' });
      return;
    }
    set({ hardwarePreference, pendingHardware: false, lastError: null });
    persistLater(get);
    set({ modelSwitching: true, pendingHardware: true });
    try {
      await desktopBridge.loadModel(state.selectedModelId, hardwarePreference);
      set({ pendingHardware: false });
    } catch (error) {
      set({ hardwarePreference: previous, pendingHardware: false, lastError: errorMessage(error) });
      persistLater(get);
      try {
        await desktopBridge.loadModel(state.selectedModelId, previous);
      } catch {
        set({
          model: {
            state: 'unloaded',
            modelId: null,
            device: null,
            computeType: null,
            deviceIndex: null,
            cpuThreads: null,
          },
        });
      }
    } finally {
      set({ modelSwitching: false });
    }
  },
  restoreHardwareDefaults: async () => {
    await get().setHardwarePreference(recommendedHardwarePreference(get().environment?.hardware));
  },
  setTheme: (theme) => {
    const next = { ...appearanceFromState(get()), theme };
    applyAppearancePreferences(next);
    set({ theme: next.theme });
    persistLater(get);
  },
  setAccentPreset: (accentPreset) => {
    const next = { ...appearanceFromState(get()), accentPreset };
    applyAppearancePreferences(next);
    set({ accentPreset });
    persistLater(get);
  },
  setCustomAccentColor: (customAccentColor) => {
    const normalized = normalizeHexColor(customAccentColor);
    if (normalized === null) return;
    const next = {
      ...appearanceFromState(get()),
      accentPreset: 'custom' as const,
      customAccentColor: normalized,
    };
    applyAppearancePreferences(next);
    set({ accentPreset: 'custom', customAccentColor: normalized });
    persistLater(get);
  },
  setUiFontSize: (uiFontSize) => {
    if (!Number.isInteger(uiFontSize) || uiFontSize < 12 || uiFontSize > 18) return;
    const next = { ...appearanceFromState(get()), uiFontSize };
    applyAppearancePreferences(next);
    set({ uiFontSize });
    persistLater(get);
  },
  setLogFontSize: (logFontSize) => {
    if (!Number.isInteger(logFontSize) || logFontSize < 10 || logFontSize > 16) return;
    const next = { ...appearanceFromState(get()), logFontSize };
    applyAppearancePreferences(next);
    set({ logFontSize });
    persistLater(get);
  },
  setUiFontFamily: (uiFontFamily) => {
    const next = { ...appearanceFromState(get()), uiFontFamily };
    applyAppearancePreferences(next);
    set({ uiFontFamily });
    persistLater(get);
  },
  setMonoFontFamily: (monoFontFamily) => {
    const next = { ...appearanceFromState(get()), monoFontFamily };
    applyAppearancePreferences(next);
    set({ monoFontFamily });
    persistLater(get);
  },
  restoreAppearanceDefaults: () => {
    applyAppearancePreferences(DEFAULT_APPEARANCE);
    set({ ...DEFAULT_APPEARANCE });
    persistLater(get);
  },
  setTaskFilter: (taskFilter) => set({ taskFilter }),
  setTaskSearch: (taskSearch) => set({ taskSearch }),
  setTaskDateRange: (taskDateRange) => set({ taskDateRange }),
  setTaskWorkspaceMode: (taskWorkspaceMode) => set({ taskWorkspaceMode }),
  addFiles: async () => {
    try {
      const sources = await desktopBridge.selectFiles();
      set((state) => ({ inputs: mergeUniqueInputs(state.inputs, sources), lastError: null }));
    } catch (error) {
      set({ lastError: errorMessage(error) });
    }
  },
  addDirectory: async () => {
    try {
      const sources = await desktopBridge.selectDirectory();
      set((state) => ({ inputs: mergeUniqueInputs(state.inputs, sources), lastError: null }));
    } catch (error) {
      set({ lastError: errorMessage(error) });
    }
  },
  addClipboardPaths: async () => {
    try {
      const content = await desktopBridge.readClipboardText();
      const paths = parseWindowsClipboardPaths(content);
      if (paths.length === 0) {
        throw new Error('剪贴板中没有可识别的 Windows 文件或文件夹路径。');
      }
      const sources = await desktopBridge.inspectPaths(paths, 'paste');
      set((state) => ({ inputs: mergeUniqueInputs(state.inputs, sources), lastError: null }));
    } catch (error) {
      set({ lastError: errorMessage(error) });
    }
  },
  chooseOutputDirectory: async () => {
    try {
      const rootDirectory = await desktopBridge.selectOutputDirectory();
      if (rootDirectory !== null) {
        set((state) => ({
          output: {
            ...state.output,
            mode: 'custom',
            rootDirectory,
            preserveSourceTxt:
              state.output.mode === 'custom' ? state.output.preserveSourceTxt : false,
            preserveSourceMarkdown:
              state.output.mode === 'custom' ? state.output.preserveSourceMarkdown : false,
          },
          lastError: null,
        }));
        persistLater(get);
      }
    } catch (error) {
      set({ lastError: errorMessage(error) });
    }
  },
  restoreDefaultOutputDirectory: () => {
    set((state) => ({
      output: {
        ...state.output,
        mode: 'compatibility',
        rootDirectory: null,
        preserveSourceTxt: false,
        preserveSourceMarkdown: false,
      },
      lastError: null,
    }));
    persistLater(get);
  },
  removeInput: (id) => set((state) => ({ inputs: state.inputs.filter((item) => item.id !== id) })),
  clearInputs: () => set({ inputs: [] }),
  selectProfile: (profileMode, id) => {
    const subtitleParameters = getSubtitlePreset(id).subtitleParameters;
    const parameterProfiles = get().parameterProfiles;
    const modelId = get().selectedModelId;
    set({
      profileMode,
      selectedPresetId: id,
      parameters: profileParameters(parameterProfiles, modelId, id),
      overrides: profileOverrides(parameterProfiles, modelId, id),
      recognitionStrategy: DEFAULT_RECOGNITION_STRATEGY,
      subtitleParameters: { ...subtitleParameters },
      subtitleOverrides: {},
      output:
        profileMode === 'subtitle'
          ? {
              ...get().output,
              txtEnabled: false,
              markdownEnabled: false,
              srtEnabled: true,
              preserveSourceTxt: false,
              preserveSourceMarkdown: false,
            }
          : {
              ...get().output,
              txtEnabled:
                get().output.txtEnabled || get().output.markdownEnabled
                  ? get().output.txtEnabled
                  : true,
              srtEnabled: false,
              preserveSourceTxt: false,
              preserveSourceMarkdown: false,
            },
    });
    persistLater(get);
  },
  setParameter: (key, value) =>
    set((state) => {
      if (
        key === 'task' &&
        value === 'translate' &&
        !translationTaskSupported(state.selectedModelId, state.selectedPresetId)
      ) {
        return {
          lastError:
            state.selectedModelId === 'large-v3-turbo'
              ? 'Large V3 Turbo 未针对翻译任务训练；请切换到 Large V3 后再选择翻译为英语。'
              : '翻译为英语仅在英文转录与英文防幻觉模式中开放。',
        };
      }
      const normalizedValue =
        (key === 'initial_prompt' || key === 'hotwords') && typeof value === 'string'
          ? normalizePromptText(value)
          : value;
      const parameters = { ...state.parameters, [key]: normalizedValue };
      const base = getPreset(state.selectedPresetId, state.selectedModelId).parameters;
      const overrides = Object.fromEntries(
        Object.entries(parameters).filter(([name, current]) => {
          const parameterName = name as keyof EditableParameters;
          if (
            parameterName === 'temperature' &&
            Object.prototype.hasOwnProperty.call(state.overrides, 'temperature')
          ) {
            return true;
          }
          return current !== base[parameterName];
        }),
      ) as Partial<EditableParameters>;
      const parameterProfiles = withProfileOverrides(
        state.parameterProfiles,
        state.selectedModelId,
        state.selectedPresetId,
        overrides,
      );
      queueMicrotask(() => persistLater(get));
      return { parameters, overrides, parameterProfiles, lastError: null };
    }),
  setTemperatureMode: (mode) =>
    set((state) => {
      const base = getPreset(state.selectedPresetId, state.selectedModelId).parameters;
      const overrides = { ...state.overrides };
      const parameters = { ...state.parameters };
      if (mode === 'model') {
        delete overrides.temperature;
        parameters.temperature = base.temperature;
      } else {
        overrides.temperature = parameters.temperature;
      }
      const parameterProfiles = withProfileOverrides(
        state.parameterProfiles,
        state.selectedModelId,
        state.selectedPresetId,
        overrides,
      );
      queueMicrotask(() => persistLater(get));
      return { parameters, overrides, parameterProfiles };
    }),
  setSubtitleParameter: (key, value) =>
    set((state) => {
      const subtitleParameters = { ...state.subtitleParameters, [key]: value };
      const base = getSubtitlePreset(state.selectedPresetId).subtitleParameters;
      const subtitleOverrides = Object.fromEntries(
        Object.entries(subtitleParameters).filter(([name, current]) => {
          const parameterName = name as keyof SubtitleParameters;
          return current !== base[parameterName];
        }),
      ) as Partial<SubtitleParameters>;
      queueMicrotask(() => persistLater(get));
      return { subtitleParameters, subtitleOverrides };
    }),
  restorePreset: () => {
    const preset = getPreset(get().selectedPresetId, get().selectedModelId);
    const subtitle = getSubtitlePreset(get().selectedPresetId);
    set({
      parameters: { ...preset.parameters },
      overrides: {},
      parameterProfiles: withProfileOverrides(
        get().parameterProfiles,
        get().selectedModelId,
        get().selectedPresetId,
        {},
      ),
      recognitionStrategy: 'stable_primary',
      recognitionStrategyProfiles: {},
      subtitleParameters: { ...subtitle.subtitleParameters },
      subtitleOverrides: {},
    });
    persistLater(get);
  },
  setOutput: (patch) => {
    set((state) => ({
      output: {
        ...state.output,
        ...patch,
      },
    }));
    persistLater(get);
  },
  startTask: async () => {
    const state = get();
    if (state.inputs.length === 0) return;
    if (
      state.parameters.task === 'translate' &&
      !translationTaskSupported(state.selectedModelId, state.selectedPresetId)
    ) {
      set({
        lastError:
          state.selectedModelId === 'large-v3-turbo'
            ? 'Large V3 Turbo 不支持可靠的语音翻译；请切换到 Large V3。'
            : '当前模型与识别模式组合不支持翻译为英语。',
        activeView: 'models',
      });
      return;
    }
    if (state.inputs.some((input) => !input.valid)) {
      set({ lastError: '输入列表中存在无效路径，请移除或重新选择。' });
      return;
    }
    if (state.output.mode === 'custom' && state.output.rootDirectory === null) {
      set({ lastError: '自定义输出需要先选择真实输出根目录。' });
      return;
    }
    if (!state.output.txtEnabled && !state.output.markdownEnabled && !state.output.srtEnabled) {
      set({ lastError: '请至少启用一种输出格式。' });
      return;
    }
    if (state.hostStatus.state !== 'ready') {
      set({ lastError: '本地推理 Worker 尚未就绪。' });
      return;
    }
    if (!hardwarePreferenceSupported(state.hardwarePreference, state.environment?.hardware)) {
      set({
        lastError: '当前默认硬件配置在本机不可用，请重新选择。',
        activeView: 'hardware',
      });
      return;
    }
    try {
      const localModels = await desktopBridge.listLocalModels();
      set({ localModels });
      if (!localModels.some((item) => item.id === state.selectedModelId && item.installed)) {
        set({
          lastError: `模型 ${state.selectedModelId} 已缺失或安装不完整。`,
          activeView: 'models',
        });
        return;
      }
    } catch (error) {
      set({ lastError: errorMessage(error) });
      return;
    }
    const draft: TranscriptionDraft = {
      inputs: state.inputs,
      modelId: state.selectedModelId,
      recognitionStrategy: DEFAULT_RECOGNITION_STRATEGY,
      basePresetId: state.selectedPresetId,
      profileMode: state.profileMode,
      overrides: normalizedTaskOverrides(state.overrides),
      effectiveParameters: state.parameters,
      subtitleParameters: state.subtitleParameters,
      output: state.output,
      hardware: state.hardwarePreference,
    };
    if (state.finishAction === 'shutdown') {
      set({ pendingShutdownStart: { draft }, lastError: null });
      return;
    }
    set({ startingTask: true, lastError: null });
    try {
      await desktopBridge.startTranscription(draft);
      set({ inputs: [], finishAction: 'none', activeView: 'performance' });
    } catch (error) {
      const conflict = outputConflictDetails(error);
      if (conflict !== null) {
        set({
          pendingOverwrite: {
            draft,
            ...conflict,
            mode: draft.output.conflictPolicy === 'confirm_skip' ? 'skip' : 'overwrite',
            finishAction: state.finishAction,
            source: 'workspace',
          },
          lastError: null,
          selectedTaskId: null,
        });
      } else {
        set({ lastError: errorMessage(error) });
      }
    } finally {
      set({ startingTask: false });
    }
  },
  confirmShutdownStart: async () => {
    const pending = get().pendingShutdownStart;
    if (pending === null || get().startingTask) return;
    set({ startingTask: true, shutdownArmed: true, lastError: null });
    try {
      await desktopBridge.startTranscription(pending.draft, { finishAction: 'shutdown' });
      set({
        pendingShutdownStart: null,
        inputs: [],
        finishAction: 'none',
        activeView: 'performance',
      });
    } catch (error) {
      const conflict = outputConflictDetails(error);
      if (conflict !== null) {
        set({
          pendingShutdownStart: null,
          shutdownArmed: false,
          pendingOverwrite: {
            draft: pending.draft,
            ...conflict,
            mode: pending.draft.output.conflictPolicy === 'confirm_skip' ? 'skip' : 'overwrite',
            finishAction: 'shutdown',
            source: 'workspace',
          },
          lastError: null,
          selectedTaskId: null,
        });
      } else {
        set({
          pendingShutdownStart: null,
          shutdownArmed: false,
          lastError: errorMessage(error),
        });
      }
    } finally {
      set({ startingTask: false });
    }
  },
  cancelShutdownStart: () => set({ pendingShutdownStart: null }),
  confirmOverwrite: async () => {
    const pending = get().pendingOverwrite;
    if (pending === null || get().startingTask) return;
    const armsShutdown = pending.finishAction === 'shutdown';
    set({
      startingTask: true,
      shutdownArmed: armsShutdown ? true : get().shutdownArmed,
      lastError: null,
    });
    try {
      await desktopBridge.startTranscription(pending.draft, {
        allowOverwrite: pending.mode === 'overwrite',
        skipConflicts: pending.mode === 'skip',
        finishAction: pending.finishAction,
      });
      set({
        pendingOverwrite: null,
        inputs: pending.source === 'workspace' ? [] : get().inputs,
        finishAction: pending.source === 'workspace' ? 'none' : get().finishAction,
        activeView: 'performance',
        selectedTaskId: pending.source === 'resume' ? null : get().selectedTaskId,
      });
    } catch (error) {
      if (isAllOutputsSkipped(error) && pending.mode === 'skip') {
        set({
          pendingOverwrite: null,
          shutdownArmed: armsShutdown ? false : get().shutdownArmed,
          lastError: null,
          activeView: pending.source === 'workspace' ? 'workspace' : 'tasks',
        });
      } else {
        set({
          pendingOverwrite: null,
          shutdownArmed: armsShutdown ? false : get().shutdownArmed,
          lastError: errorMessage(error),
        });
      }
    } finally {
      set({ startingTask: false });
    }
  },
  cancelOverwrite: () => set({ pendingOverwrite: null }),
  cancelTask: async (taskId) => {
    try {
      await desktopBridge.cancelTask(taskId);
    } catch (error) {
      set({ lastError: errorMessage(error) });
    }
  },
  revealTaskOutput: async (taskId) => {
    const task = get().tasks.find((item) => item.id === taskId);
    const output = task?.outputs?.[0];
    if (task?.outputAvailability === 'missing') {
      set({ lastError: '该任务记录的输出文件已经被删除、移动或改名。' });
      return;
    }
    if (output === undefined) {
      set({ lastError: '该任务没有可定位的输出文件。' });
      return;
    }
    try {
      await desktopBridge.revealOutput(output);
    } catch (error) {
      set((state) => ({
        lastError: errorMessage(error),
        tasks: state.tasks.map((item) =>
          item.id === taskId ? { ...item, outputAvailability: 'missing' } : item,
        ),
      }));
      persistLater(get);
    }
  },
  openTaskOutputDirectory: async (taskId) => {
    const task = get().tasks.find((item) => item.id === taskId);
    const outputs = taskOutputPaths(task);
    if (outputs.length === 0) {
      set({ lastError: '该任务还没有可打开的输出目录。' });
      return;
    }
    try {
      const statuses = await desktopBridge.inspectOutputPaths(outputs);
      const available = statuses.filter((status) => status.exists).map((status) => status.path);
      if (available.length === 0) {
        set((state) => ({
          lastError: '该任务记录的输出文件已经被删除、移动或改名。',
          tasks: state.tasks.map((item) =>
            item.id === taskId ? { ...item, outputAvailability: 'missing' } : item,
          ),
        }));
        persistLater(get);
        return;
      }
      let lastOpenError: unknown = null;
      for (const path of available) {
        try {
          await desktopBridge.openOutputDirectory(path);
          set({ lastError: null });
          return;
        } catch (error) {
          lastOpenError = error;
        }
      }
      set({ lastError: errorMessage(lastOpenError) });
    } catch (error) {
      set({ lastError: errorMessage(error) });
    }
  },
  auditTaskOutputs: async () => {
    if (get().outputAuditPending) return;
    const completedTasks = get().tasks.filter((task) => task.status === 'completed');
    if (completedTasks.length === 0) return;
    set({ outputAuditPending: true });
    const paths = [...new Set(completedTasks.flatMap((task) => task.outputs ?? []))];
    try {
      const statuses = paths.length === 0 ? [] : await desktopBridge.inspectOutputPaths(paths);
      const availability = new Map(statuses.map((status) => [status.path, status.exists]));
      set((state) => ({
        tasks: state.tasks.map((task) => {
          if (task.status !== 'completed') return task;
          const outputs = task.outputs ?? [];
          const outputAvailability =
            outputs.length > 0 && outputs.every((output) => availability.get(output) === true)
              ? 'available'
              : 'missing';
          return { ...task, outputAvailability };
        }),
      }));
      persistLater(get);
    } catch {
      // A failed diagnostic must not turn valid completed tasks into missing output records.
    } finally {
      set({ outputAuditPending: false });
    }
  },
  selectTask: async (taskId) => {
    set({ selectedTaskId: taskId, outputPreview: null, previewLoading: false });
    if (taskId === null) return;
    const task = get().tasks.find((item) => item.id === taskId);
    const output = task?.outputs?.[0];
    if (
      task?.status !== 'completed' ||
      task.outputAvailability === 'missing' ||
      output === undefined
    )
      return;
    set({ previewLoading: true });
    try {
      const outputPreview = await desktopBridge.readOutputPreview(output);
      if (get().selectedTaskId === taskId) set({ outputPreview });
    } catch (error) {
      set((state) => ({
        lastError: errorMessage(error),
        tasks: state.tasks.map((item) =>
          item.id === taskId ? { ...item, outputAvailability: 'missing' } : item,
        ),
      }));
      persistLater(get);
    } finally {
      if (get().selectedTaskId === taskId) set({ previewLoading: false });
    }
  },
  retryTask: async (taskId) => {
    const task = get().tasks.find((item) => item.id === taskId);
    if (task?.draft === undefined) {
      set({ lastError: '该历史任务没有可复用的参数快照。' });
      return;
    }
    const retryDraftSnapshot = normalizeDraft(task.draft);
    if (draftHasUnsupportedTranslation(retryDraftSnapshot)) {
      set({
        lastError: '该历史任务使用 Large V3 Turbo 翻译，无法保证英语输出；请改用 Large V3。',
        activeView: 'models',
      });
      return;
    }
    set({ startingTask: true, lastError: null });
    try {
      const inputs = await desktopBridge.inspectPaths(
        task.draft.inputs.map((input) => input.path),
        'manual',
      );
      const hasInvalidInputs = inputs.some((input) => !input.valid);
      set({
        inputs,
        selectedModelId: retryDraftSnapshot.modelId,
        hardwarePreference: { ...retryDraftSnapshot.hardware },
        selectedPresetId: retryDraftSnapshot.basePresetId,
        profileMode: retryDraftSnapshot.profileMode,
        parameters: { ...retryDraftSnapshot.effectiveParameters },
        overrides: { ...retryDraftSnapshot.overrides },
        recognitionStrategy: DEFAULT_RECOGNITION_STRATEGY,
        recognitionStrategyProfiles: {},
        parameterProfiles: withProfileOverrides(
          get().parameterProfiles,
          retryDraftSnapshot.modelId,
          retryDraftSnapshot.basePresetId,
          retryDraftSnapshot.overrides,
        ),
        subtitleParameters: { ...retryDraftSnapshot.subtitleParameters },
        subtitleOverrides: subtitleOverridesFor(retryDraftSnapshot),
        output: { ...retryDraftSnapshot.output },
        finishAction: 'none',
        pendingOverwrite: null,
        activeView: 'workspace',
        selectedTaskId: null,
        lastError: hasInvalidInputs
          ? '已载入原配置，但一个或多个历史输入路径当前无效，请调整后再执行。'
          : null,
      });
      persistLater(get);
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
    } catch (error) {
      set({ lastError: errorMessage(error) });
    } finally {
      set({ startingTask: false });
    }
  },
  resumeTask: async (taskId) => {
    const task = get().tasks.find((item) => item.id === taskId);
    if (task?.draft === undefined || !canResumeTask(task)) {
      set({ lastError: '该任务没有可靠的媒体完成清单，无法直接继续。' });
      return;
    }
    if (get().hostStatus.state !== 'ready') {
      set({ lastError: '本地推理 Worker 尚未就绪。' });
      return;
    }
    const resumeDraftSnapshot = normalizeDraft(task.draft);
    if (draftHasUnsupportedTranslation(resumeDraftSnapshot)) {
      set({
        lastError: '该历史任务使用 Large V3 Turbo 翻译，无法安全续接；请改用 Large V3 新建任务。',
        activeView: 'models',
      });
      return;
    }
    if (!hardwarePreferenceSupported(resumeDraftSnapshot.hardware, get().environment?.hardware)) {
      set({
        lastError: '原任务的硬件配置在当前设备上不可用。',
        activeView: 'hardware',
      });
      return;
    }
    set({ startingTask: true, lastError: null });
    let resumeDraft: TranscriptionDraft | null = null;
    try {
      const localModels = await desktopBridge.listLocalModels();
      set({ localModels });
      if (!localModels.some((item) => item.id === resumeDraftSnapshot.modelId && item.installed)) {
        throw new Error(`原任务使用的模型 ${resumeDraftSnapshot.modelId} 已缺失或安装不完整。`);
      }

      const mediaStates = task.mediaStates ?? [];
      const completedOutputPaths = mediaStates
        .filter((media) => media.status === 'completed' || media.status === 'skipped')
        .flatMap((media) => media.outputPaths ?? []);
      const outputStatuses =
        completedOutputPaths.length === 0
          ? []
          : await desktopBridge.inspectOutputPaths([...new Set(completedOutputPaths)]);
      const existingOutputs = new Set(
        outputStatuses
          .filter((status) => status.exists)
          .map((status) => status.path.toLocaleLowerCase()),
      );
      const remainingPaths = mediaStates
        .filter((media) => {
          if (media.status !== 'completed' && media.status !== 'skipped') return true;
          const outputs = media.outputPaths ?? [];
          return (
            outputs.length === 0 ||
            outputs.some((path) => !existingOutputs.has(path.toLocaleLowerCase()))
          );
        })
        .map((media) => media.path);
      if (remainingPaths.length === 0) {
        throw new Error('已完成媒体的输出仍然存在，没有需要继续处理的媒体。');
      }
      const inputs = await desktopBridge.inspectPaths(remainingPaths, 'manual');
      if (inputs.some((input) => !input.valid)) {
        throw new Error('待继续媒体中的一个或多个输入路径已失效。');
      }
      resumeDraft = { ...resumeDraftSnapshot, inputs };
      await desktopBridge.startTranscription(resumeDraft);
      set({ activeView: 'performance', selectedTaskId: null, finishAction: 'none' });
    } catch (error) {
      const conflict = outputConflictDetails(error);
      if (conflict !== null && resumeDraft !== null) {
        set({
          pendingOverwrite: {
            draft: resumeDraft,
            ...conflict,
            mode: resumeDraft.output.conflictPolicy === 'confirm_skip' ? 'skip' : 'overwrite',
            finishAction: 'none',
            source: 'resume',
          },
          lastError: null,
          selectedTaskId: null,
        });
      } else {
        set({ lastError: errorMessage(error) });
      }
    } finally {
      set({ startingTask: false });
    }
  },
  clearCompletedHistory: () => {
    if (get().outputAuditPending) return;
    set((state) => {
      const tasks = state.tasks.filter(
        (task) => task.status !== 'completed' || task.outputAvailability === 'missing',
      );
      return {
        tasks,
        monitoredTaskId: tasks.some((task) => task.id === state.monitoredTaskId)
          ? state.monitoredTaskId
          : activeTaskId(tasks),
        selectedTaskId: null,
        outputPreview: null,
      };
    });
    persistLater(get);
  },
  clearAbnormalHistory: () => {
    if (get().outputAuditPending) return;
    set((state) => {
      const tasks = state.tasks.filter((task) => !isAbnormalTask(task));
      return {
        tasks,
        monitoredTaskId: tasks.some((task) => task.id === state.monitoredTaskId)
          ? state.monitoredTaskId
          : activeTaskId(tasks),
        selectedTaskId: null,
        outputPreview: null,
      };
    });
    persistLater(get);
  },
  deleteTaskHistory: (taskId) => {
    const task = get().tasks.find((item) => item.id === taskId);
    if (task === undefined || task.status === 'running' || task.status === 'queued') return;
    set((state) => ({
      tasks: state.tasks.filter((item) => item.id !== taskId),
      monitoredTaskId:
        state.monitoredTaskId === taskId
          ? activeTaskId(state.tasks.filter((item) => item.id !== taskId))
          : state.monitoredTaskId,
      selectedTaskId: state.selectedTaskId === taskId ? null : state.selectedTaskId,
      outputPreview: state.selectedTaskId === taskId ? null : state.outputPreview,
      previewLoading: state.selectedTaskId === taskId ? false : state.previewLoading,
    }));
    persistLater(get);
  },
  exportConfig: () => {
    set({ configText: exportPreferences(preferencesFromState(get())), lastError: null });
  },
  setConfigText: (configText) => set({ configText }),
  importConfig: () => {
    try {
      const preferences = importPreferences(get().configText);
      applyAppearancePreferences(preferences);
      set({ ...preferences, lastError: null });
      persistLater(get);
    } catch (error) {
      set({ lastError: errorMessage(error) });
    }
  },
  restartWorker: async () => {
    set({ lastError: null });
    try {
      const hostStatus = await desktopBridge.restartWorker();
      set({ hostStatus });
    } catch (error) {
      set({ lastError: errorMessage(error) });
    }
  },
  clearError: () => set({ lastError: null }),
  handleEvent: (event) => handleWorkspaceEvent(event, set, get, persistLater),
  initialize: () => {
    if (get().initialized) return () => undefined;
    if (desktopBridge.mode === 'tauri') {
      const persisted = loadWorkspaceState();
      if (persisted !== null) {
        applyAppearancePreferences(persisted.preferences);
        set({
          ...persisted.preferences,
          tasks: persisted.tasks,
          monitoredTaskId: activeTaskId(persisted.tasks) ?? persisted.tasks.at(0)?.id ?? null,
        });
      } else {
        applyAppearancePreferences(appearanceFromState(get()));
      }
    } else {
      applyAppearancePreferences(appearanceFromState(get()));
    }
    set({ initialized: true });
    const unlisten = desktopBridge.subscribe((event) => get().handleEvent(event));
    void desktopBridge
      .getHostStatus()
      .then((hostStatus) => set({ hostStatus }))
      .catch((error: unknown) => set({ lastError: errorMessage(error) }));
    void get().refreshModels();
    void desktopBridge
      .getPowerCapabilities()
      .then((powerCapabilities) => set({ powerCapabilities }))
      .catch(() => set({ powerCapabilities: { shutdown: false } }));
    void desktopBridge
      .getPowerActionStatus()
      .then((powerActionStatus) =>
        set({
          powerActionStatus,
          shutdownArmed:
            powerActionStatus.state === 'armed' || powerActionStatus.state === 'countdown',
        }),
      )
      .catch(() => undefined);
    const systemTheme = window.matchMedia?.('(prefers-color-scheme: light)');
    const handleSystemThemeChange = () => {
      if (get().theme === 'system') applyAppearancePreferences(appearanceFromState(get()));
    };
    systemTheme?.addEventListener?.('change', handleSystemThemeChange);
    return () => {
      unlisten();
      systemTheme?.removeEventListener?.('change', handleSystemThemeChange);
      set({ initialized: false });
    };
  },
}));

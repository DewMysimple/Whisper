import { create } from 'zustand';

import { desktopBridge } from '../bridge';
import { notifyTaskFinished } from '../notifications';
import type {
  DesktopEvent,
  EditableParameters,
  HardwarePreference,
  HostStatus,
  InputSource,
  LocalModelDescriptor,
  ModelId,
  ModelStatus,
  OutputPreview,
  OutputPolicy,
  PerformanceSample,
  ProfileMode,
  PresetId,
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
  saveWorkspaceState,
  type AccentPreset,
  type MonoFontFamily,
  type ThemePreference,
  type UiFontFamily,
  type WorkspacePreferences,
} from './persistence';
import { appendPerformanceSample } from './performanceWindow';
import {
  DEFAULT_HARDWARE_PREFERENCE,
  hardwarePreferenceSupported,
  recommendedHardwarePreference,
} from './hardware';
import type { TaskDateRange } from './taskHistory';

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
    sourceCount: 1,
    presetId: 'cn2',
    modelId: 'large-v3-turbo',
    isCustom: false,
    status: 'running',
    progress: 63,
    stage: 'GPU 转录中',
    elapsed: '03:18',
    createdAt: '2026-07-22T21:42:00+08:00',
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
export type WorkspaceViewId =
  'workspace' | 'models' | 'performance' | 'tasks' | 'logs' | 'settings';

export interface PendingOverwrite {
  draft: TranscriptionDraft;
  paths: string[];
  source: 'workspace' | 'retry';
}

interface WorkspaceState {
  inputs: InputSource[];
  selectedModelId: ModelId;
  hardwarePreference: HardwarePreference;
  selectedPresetId: PresetId;
  profileMode: ProfileMode;
  parameters: EditableParameters;
  overrides: Partial<EditableParameters>;
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
  logs: string[];
  lastError: string | null;
  startingTask: boolean;
  activeView: WorkspaceViewId;
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
  configText: string;
  initialized: boolean;
  setActiveView(view: WorkspaceState['activeView']): void;
  refreshModels(): Promise<void>;
  openModelDirectory(): Promise<void>;
  selectModel(modelId: ModelId): Promise<void>;
  setHardwarePreference(preference: HardwarePreference): Promise<void>;
  restoreHardwareDefaults(): Promise<void>;
  confirmOverwrite(): Promise<void>;
  cancelOverwrite(): void;
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
  addFiles(): Promise<void>;
  addDirectory(): Promise<void>;
  addPastedPaths(paths: string[]): Promise<void>;
  chooseOutputDirectory(): Promise<void>;
  restoreDefaultOutputDirectory(): void;
  removeInput(id: string): void;
  clearInputs(): void;
  selectProfile(mode: ProfileMode, id: PresetId): void;
  setParameter<K extends keyof EditableParameters>(key: K, value: EditableParameters[K]): void;
  setSubtitleParameter<K extends keyof SubtitleParameters>(
    key: K,
    value: SubtitleParameters[K],
  ): void;
  restorePreset(): void;
  setOutput(patch: Partial<OutputPolicy>): void;
  startTask(): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  revealTaskOutput(taskId: string): Promise<void>;
  auditTaskOutputs(): Promise<void>;
  selectTask(taskId: string | null): Promise<void>;
  retryTask(taskId: string): Promise<void>;
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
  logs: [],
  lastError: null,
  startingTask: false,
  activeView: 'workspace',
  ...DEFAULT_APPEARANCE,
  selectedTaskId: null,
  outputPreview: null,
  previewLoading: false,
  outputAuditPending: false,
  taskFilter: 'all',
  taskSearch: '',
  taskDateRange: null,
  configText: '',
  initialized: false,

  setActiveView: (activeView) => set({ activeView }),
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
    set({ selectedModelId: modelId, pendingModelId: busy ? modelId : null, lastError: null });
    persistLater(get);
    if (busy) return;
    set({ modelSwitching: true });
    try {
      await desktopBridge.loadModel(modelId, state.hardwarePreference);
      set({ pendingModelId: null });
    } catch (error) {
      set({ selectedModelId: previous, pendingModelId: null, lastError: errorMessage(error) });
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
      set({ lastError: '当前本机不支持所选硬件配置。', activeView: 'models' });
      return;
    }
    const previous = state.hardwarePreference;
    const busy = state.tasks.some((task) => task.status === 'queued' || task.status === 'running');
    set({ hardwarePreference, pendingHardware: busy, lastError: null });
    persistLater(get);
    if (busy) return;
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
  addPastedPaths: async (paths) => {
    try {
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
    set({
      profileMode,
      selectedPresetId: id,
      parameters: { ...getPreset(id).parameters },
      overrides: {},
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
      const parameters = { ...state.parameters, [key]: value };
      const base = getPreset(state.selectedPresetId).parameters;
      const overrides = Object.fromEntries(
        Object.entries(parameters).filter(([name, current]) => {
          const parameterName = name as keyof EditableParameters;
          return current !== base[parameterName];
        }),
      ) as Partial<EditableParameters>;
      queueMicrotask(() => persistLater(get));
      return { parameters, overrides };
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
    const preset = getPreset(get().selectedPresetId);
    const subtitle = getSubtitlePreset(get().selectedPresetId);
    set({
      parameters: { ...preset.parameters },
      overrides: {},
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
        activeView: 'models',
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
    set({ startingTask: true, lastError: null });
    const draft: TranscriptionDraft = {
      inputs: state.inputs,
      modelId: state.selectedModelId,
      basePresetId: state.selectedPresetId,
      profileMode: state.profileMode,
      overrides: state.overrides,
      effectiveParameters: state.parameters,
      subtitleParameters: state.subtitleParameters,
      output: state.output,
      hardware: state.hardwarePreference,
    };
    try {
      await desktopBridge.startTranscription(draft);
      set({ inputs: [], activeView: 'performance' });
    } catch (error) {
      const paths = outputConflictPaths(error);
      if (paths !== null) {
        set({ pendingOverwrite: { draft, paths, source: 'workspace' }, lastError: null });
      } else {
        set({ lastError: errorMessage(error) });
      }
    } finally {
      set({ startingTask: false });
    }
  },
  confirmOverwrite: async () => {
    const pending = get().pendingOverwrite;
    if (pending === null || get().startingTask) return;
    set({ startingTask: true, lastError: null });
    try {
      await desktopBridge.startTranscription(pending.draft, { allowOverwrite: true });
      set({
        pendingOverwrite: null,
        inputs: pending.source === 'workspace' ? [] : get().inputs,
        activeView: 'performance',
        selectedTaskId: pending.source === 'retry' ? null : get().selectedTaskId,
      });
    } catch (error) {
      set({ pendingOverwrite: null, lastError: errorMessage(error) });
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
    if (get().hostStatus.state !== 'ready') {
      set({ lastError: '本地推理 Worker 尚未就绪。' });
      return;
    }
    const retryDraftSnapshot = normalizeDraft(task.draft);
    if (!hardwarePreferenceSupported(retryDraftSnapshot.hardware, get().environment?.hardware)) {
      set({
        lastError: '原任务的硬件配置在当前设备上不可用。',
        activeView: 'models',
      });
      return;
    }
    set({ startingTask: true, lastError: null });
    let retryDraft: TranscriptionDraft | null = null;
    try {
      const localModels = await desktopBridge.listLocalModels();
      set({ localModels });
      if (!localModels.some((item) => item.id === task.modelId && item.installed)) {
        throw new Error(`原任务使用的模型 ${task.modelId} 已缺失或安装不完整。`);
      }
      const inputs = await desktopBridge.inspectPaths(
        task.draft.inputs.map((input) => input.path),
        'manual',
      );
      if (inputs.some((input) => !input.valid)) {
        throw new Error('历史任务的一个或多个输入路径已失效。');
      }
      retryDraft = { ...retryDraftSnapshot, inputs };
      await desktopBridge.startTranscription(retryDraft);
      set({ activeView: 'performance', selectedTaskId: null });
    } catch (error) {
      const paths = outputConflictPaths(error);
      if (paths !== null && retryDraft !== null) {
        set({
          pendingOverwrite: {
            draft: retryDraft,
            paths,
            source: 'retry',
          },
          lastError: null,
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
    set((state) => ({
      tasks: state.tasks.filter(
        (task) => task.status !== 'completed' || task.outputAvailability === 'missing',
      ),
      selectedTaskId: null,
      outputPreview: null,
    }));
    persistLater(get);
  },
  clearAbnormalHistory: () => {
    if (get().outputAuditPending) return;
    set((state) => ({
      tasks: state.tasks.filter((task) => !isAbnormalTask(task)),
      selectedTaskId: null,
      outputPreview: null,
    }));
    persistLater(get);
  },
  deleteTaskHistory: (taskId) => {
    const task = get().tasks.find((item) => item.id === taskId);
    if (task === undefined || task.status === 'running' || task.status === 'queued') return;
    set((state) => ({
      tasks: state.tasks.filter((item) => item.id !== taskId),
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
  handleEvent: (event) => {
    if (event.type === 'inputs.added') {
      set((state) => ({ inputs: mergeUniqueInputs(state.inputs, event.inputs) }));
      return;
    }
    if (event.type === 'host.status') {
      set({ hostStatus: event.status, lastError: event.status.error });
      return;
    }
    if (event.type === 'worker.environment') {
      set({ environment: event.environment });
      return;
    }
    if (event.type === 'model.status') {
      set({
        model: event.model,
        pendingModelId:
          event.model.state === 'ready' && event.model.modelId === get().selectedModelId
            ? null
            : get().pendingModelId,
        pendingHardware:
          event.model.state === 'ready' &&
          modelMatchesPreference(event.model, get().hardwarePreference, get().environment?.hardware)
            ? false
            : get().pendingHardware,
      });
      return;
    }
    if (event.type === 'worker.log') {
      set((state) => ({ logs: [...state.logs.slice(-199), event.line] }));
      return;
    }
    if (event.type === 'worker.error') {
      set({ lastError: event.message });
      return;
    }
    if (event.type === 'performance.sample') {
      set((state) => ({
        performance: event.sample,
        performanceHistory: appendPerformanceSample(state.performanceHistory, event.sample),
      }));
      return;
    }
    if (event.type === 'task.queued') {
      set((state) => ({ tasks: [event.task, ...state.tasks] }));
      persistLater(get);
      return;
    }
    if (event.type === 'task.progress') {
      set((state) => ({
        tasks: state.tasks.map((task) => {
          if (task.id !== event.taskId || isTerminalTaskStatus(task.status)) return task;
          return {
            ...task,
            status: 'running',
            progress: event.progress,
            stage: event.stage,
            elapsed: event.elapsed,
            activeInput: event.inputPath ?? task.activeInput,
          };
        }),
      }));
      persistLater(get);
      return;
    }
    const finishedTask = get().tasks.find((task) => task.id === event.taskId);
    if (finishedTask === undefined || isTerminalTaskStatus(finishedTask.status)) return;
    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.id !== event.taskId) return task;
        if (event.type === 'task.completed') {
          return {
            ...task,
            status: 'completed',
            progress: 100,
            stage: '输出已生成',
            elapsed: event.elapsed,
            outputs: event.outputs,
            outputAvailability: event.outputs.length > 0 ? 'available' : 'missing',
            completedAt: new Date().toISOString(),
          };
        }
        if (event.type === 'task.failed') {
          return {
            ...task,
            status: 'failed',
            stage: event.message,
            errorCode: event.code,
            completedAt: new Date().toISOString(),
          };
        }
        return {
          ...task,
          status: 'cancelled',
          stage: '已取消',
          completedAt: new Date().toISOString(),
        };
      }),
    }));
    if (finishedTask !== undefined) {
      void notifyTaskFinished({
        status:
          event.type === 'task.completed'
            ? 'completed'
            : event.type === 'task.failed'
              ? 'failed'
              : 'cancelled',
        title: finishedTask.title,
        detail:
          event.type === 'task.completed'
            ? `已生成 ${event.outputs.length} 个输出文件`
            : event.type === 'task.failed'
              ? event.message
              : '任务已取消',
      });
    }
    persistLater(get);
    if (
      get().pendingModelId !== null &&
      !get().tasks.some((task) => task.status === 'queued' || task.status === 'running')
    ) {
      const pending = get().pendingModelId;
      if (pending !== null) void get().selectModel(pending);
      return;
    }
    if (
      get().pendingHardware &&
      !get().tasks.some((task) => task.status === 'queued' || task.status === 'running')
    ) {
      void get().setHardwarePreference(get().hardwarePreference);
    }
  },
  initialize: () => {
    if (get().initialized) return () => undefined;
    if (desktopBridge.mode === 'tauri') {
      const persisted = loadWorkspaceState();
      if (persisted !== null) {
        applyAppearancePreferences(persisted.preferences);
        set({ ...persisted.preferences, tasks: persisted.tasks });
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function outputConflictPaths(error: unknown): string[] | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { code?: unknown; paths?: unknown };
  if (candidate.code !== 'output.conflict' || !Array.isArray(candidate.paths)) return null;
  const paths = candidate.paths.filter((item): item is string => typeof item === 'string');
  return paths.length > 0 ? paths : null;
}

function modelMatchesPreference(
  model: ModelStatus,
  preference: HardwarePreference,
  capabilities: WorkerEnvironment['hardware'],
): boolean {
  if (model.state !== 'ready') return false;
  const expectedDevice =
    preference.mode === 'auto'
      ? (capabilities?.gpus.length ?? 0) > 0
        ? 'cuda'
        : 'cpu'
      : preference.mode;
  if (model.device !== expectedDevice) return false;
  if (expectedDevice === 'cuda') {
    return (
      model.deviceIndex === preference.gpuDeviceIndex &&
      model.computeType === preference.cudaComputeType
    );
  }
  return (
    model.computeType === preference.cpuComputeType && model.cpuThreads === preference.cpuThreads
  );
}

function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function isAbnormalTask(task: TaskSnapshot): boolean {
  return (
    task.status === 'failed' ||
    task.status === 'cancelled' ||
    (task.status === 'completed' && task.outputAvailability === 'missing')
  );
}

function normalizeDraft(draft: TranscriptionDraft): TranscriptionDraft {
  const legacy = draft as TranscriptionDraft & {
    modelId?: ModelId;
    profileMode?: ProfileMode;
    subtitleParameters?: SubtitleParameters;
    hardware?: HardwarePreference;
    output: OutputPolicy & { srtEnabled?: boolean; preserveSourceMarkdown?: boolean };
  };
  const baseParameters = getPreset(draft.basePresetId).parameters;
  return {
    ...structuredClone(draft),
    modelId: legacy.modelId ?? 'large-v3-turbo',
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
        legacy.output.conflictPolicy === 'auto_rename' ? 'auto_rename' : 'confirm_overwrite',
    },
  };
}

let persistenceTimer: ReturnType<typeof setTimeout> | undefined;

function preferencesFromState(state: WorkspaceState): WorkspacePreferences {
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
    subtitleParameters: state.subtitleParameters,
    subtitleOverrides: state.subtitleOverrides,
    output: state.output,
  };
}

function appearanceFromState(
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

function persistLater(get: () => WorkspaceState): void {
  if (desktopBridge.mode !== 'tauri') return;
  if (persistenceTimer !== undefined) clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(() => {
    const state = get();
    saveWorkspaceState(preferencesFromState(state), state.tasks);
  }, 150);
}

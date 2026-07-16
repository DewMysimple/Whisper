import { create } from 'zustand';

import { desktopBridge } from '../bridge';
import type {
  DesktopEvent,
  EditableParameters,
  HostStatus,
  InputSource,
  ModelStatus,
  OutputPreview,
  OutputPolicy,
  PerformanceSample,
  PresetId,
  TaskSnapshot,
  TaskStatus,
  TranscriptionDraft,
  WorkerEnvironment,
} from '../contracts/desktop';
import { getPreset } from '../data/presets';
import {
  applyThemePreference,
  exportPreferences,
  importPreferences,
  loadWorkspaceState,
  saveWorkspaceState,
  type ThemePreference,
  type WorkspacePreferences,
} from './persistence';

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
  gpuName: desktopBridge.mode === 'mock' ? 'RTX 5070 Ti' : null,
  timestamp: Date.now(),
};

const INITIAL_TASKS: TaskSnapshot[] = [
  {
    id: 'mock-task-1',
    title: '设计评审会议.m4a',
    sourceCount: 1,
    presetId: 'cn2',
    isCustom: false,
    status: 'running',
    progress: 63,
    stage: 'GPU 转录中',
    elapsed: '03:18',
    createdAt: '21:42',
  },
  {
    id: 'mock-task-2',
    title: 'Product Interview 06.mkv',
    sourceCount: 1,
    presetId: 'en_v1',
    isCustom: true,
    status: 'completed',
    progress: 100,
    stage: '已生成 TXT',
    elapsed: '05:24',
    createdAt: '21:30',
    outputs: ['D:\\Mock\\Product Interview 06.txt'],
  },
];

export type TaskFilter = 'all' | TaskStatus;

interface WorkspaceState {
  inputs: InputSource[];
  selectedPresetId: PresetId;
  parameters: EditableParameters;
  overrides: Partial<EditableParameters>;
  output: OutputPolicy;
  tasks: TaskSnapshot[];
  performance: PerformanceSample;
  performanceHistory: PerformanceSample[];
  hostStatus: HostStatus;
  environment: WorkerEnvironment | null;
  model: ModelStatus;
  logs: string[];
  lastError: string | null;
  startingTask: boolean;
  activeView: 'workspace' | 'tasks' | 'settings';
  theme: ThemePreference;
  selectedTaskId: string | null;
  outputPreview: OutputPreview | null;
  previewLoading: boolean;
  taskFilter: TaskFilter;
  taskSearch: string;
  configText: string;
  initialized: boolean;
  setActiveView(view: WorkspaceState['activeView']): void;
  setTheme(theme: ThemePreference): void;
  setTaskFilter(filter: TaskFilter): void;
  setTaskSearch(search: string): void;
  addFiles(): Promise<void>;
  addDirectory(): Promise<void>;
  addPastedPaths(paths: string[]): Promise<void>;
  chooseOutputDirectory(): Promise<void>;
  removeInput(id: string): void;
  clearInputs(): void;
  selectPreset(id: PresetId): void;
  setParameter<K extends keyof EditableParameters>(key: K, value: EditableParameters[K]): void;
  restorePreset(): void;
  setOutput(patch: Partial<OutputPolicy>): void;
  startTask(): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  revealTaskOutput(taskId: string): Promise<void>;
  selectTask(taskId: string | null): Promise<void>;
  retryTask(taskId: string): Promise<void>;
  clearHistory(): void;
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
  selectedPresetId: 'en_v1',
  parameters: { ...getPreset('en_v1').parameters },
  overrides: {},
  output: {
    mode: 'compatibility',
    rootDirectory: null,
    txtEnabled: true,
    markdownEnabled: false,
    preserveSourceTxt: true,
    conflictPolicy: 'fail',
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
  model: { state: 'unloaded', modelId: null, device: null, computeType: null },
  logs: [],
  lastError: null,
  startingTask: false,
  activeView: 'workspace',
  theme: 'system',
  selectedTaskId: null,
  outputPreview: null,
  previewLoading: false,
  taskFilter: 'all',
  taskSearch: '',
  configText: '',
  initialized: false,

  setActiveView: (activeView) => set({ activeView }),
  setTheme: (theme) => {
    applyThemePreference(theme);
    set({ theme });
    persistLater(get);
  },
  setTaskFilter: (taskFilter) => set({ taskFilter }),
  setTaskSearch: (taskSearch) => set({ taskSearch }),
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
          output: { ...state.output, mode: 'custom', rootDirectory },
          lastError: null,
        }));
        persistLater(get);
      }
    } catch (error) {
      set({ lastError: errorMessage(error) });
    }
  },
  removeInput: (id) => set((state) => ({ inputs: state.inputs.filter((item) => item.id !== id) })),
  clearInputs: () => set({ inputs: [] }),
  selectPreset: (id) => {
    set({
      selectedPresetId: id,
      parameters: { ...getPreset(id).parameters },
      overrides: {},
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
  restorePreset: () => {
    const preset = getPreset(get().selectedPresetId);
    set({ parameters: { ...preset.parameters }, overrides: {} });
    persistLater(get);
  },
  setOutput: (patch) => {
    set((state) => ({
      output: {
        ...state.output,
        ...patch,
        mode: patch.mode ?? (state.output.mode === 'compatibility' ? 'custom' : state.output.mode),
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
    if (state.hostStatus.state !== 'ready') {
      set({ lastError: '本地推理 Worker 尚未就绪。' });
      return;
    }
    set({ startingTask: true, lastError: null });
    try {
      await desktopBridge.startTranscription({
        inputs: state.inputs,
        basePresetId: state.selectedPresetId,
        overrides: state.overrides,
        effectiveParameters: state.parameters,
        output: state.output,
      });
      set({ inputs: [] });
    } catch (error) {
      set({ lastError: errorMessage(error) });
    } finally {
      set({ startingTask: false });
    }
  },
  cancelTask: async (taskId) => {
    try {
      await desktopBridge.cancelTask(taskId);
    } catch (error) {
      set({ lastError: errorMessage(error) });
    }
  },
  revealTaskOutput: async (taskId) => {
    const output = get().tasks.find((task) => task.id === taskId)?.outputs?.[0];
    if (output === undefined) {
      set({ lastError: '该任务没有可定位的输出文件。' });
      return;
    }
    try {
      await desktopBridge.revealOutput(output);
    } catch (error) {
      set({ lastError: errorMessage(error) });
    }
  },
  selectTask: async (taskId) => {
    set({ selectedTaskId: taskId, outputPreview: null, previewLoading: false });
    if (taskId === null) return;
    const task = get().tasks.find((item) => item.id === taskId);
    const output = task?.outputs?.[0];
    if (task?.status !== 'completed' || output === undefined) return;
    set({ previewLoading: true });
    try {
      const outputPreview = await desktopBridge.readOutputPreview(output);
      if (get().selectedTaskId === taskId) set({ outputPreview });
    } catch (error) {
      set({ lastError: errorMessage(error) });
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
    set({ startingTask: true, lastError: null });
    try {
      const inputs = await desktopBridge.inspectPaths(
        task.draft.inputs.map((input) => input.path),
        'manual',
      );
      if (inputs.some((input) => !input.valid)) {
        throw new Error('历史任务的一个或多个输入路径已失效。');
      }
      const draft: TranscriptionDraft = { ...structuredClone(task.draft), inputs };
      await desktopBridge.startTranscription(draft);
      set({ activeView: 'tasks', selectedTaskId: null });
    } catch (error) {
      set({ lastError: errorMessage(error) });
    } finally {
      set({ startingTask: false });
    }
  },
  clearHistory: () => {
    set((state) => ({
      tasks: state.tasks.filter((task) => task.status === 'queued' || task.status === 'running'),
      selectedTaskId: null,
      outputPreview: null,
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
      applyThemePreference(preferences.theme);
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
      set({ model: event.model });
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
        performanceHistory: [...state.performanceHistory.slice(-59), event.sample],
      }));
      return;
    }
    if (event.type === 'task.queued') {
      set((state) => ({ tasks: [event.task, ...state.tasks] }));
      persistLater(get);
      return;
    }
    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.id !== event.taskId) return task;
        if (event.type === 'task.progress') {
          return {
            ...task,
            status: 'running',
            progress: event.progress,
            stage: event.stage,
            elapsed: event.elapsed,
            activeInput: event.inputPath ?? task.activeInput,
          };
        }
        if (event.type === 'task.completed') {
          return {
            ...task,
            status: 'completed',
            progress: 100,
            stage: '输出已生成',
            elapsed: event.elapsed,
            outputs: event.outputs,
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
    persistLater(get);
  },
  initialize: () => {
    if (get().initialized) return () => undefined;
    if (desktopBridge.mode === 'tauri') {
      const persisted = loadWorkspaceState();
      if (persisted !== null) {
        applyThemePreference(persisted.preferences.theme);
        set({ ...persisted.preferences, tasks: persisted.tasks });
      } else {
        applyThemePreference(get().theme);
      }
    } else {
      applyThemePreference(get().theme);
    }
    set({ initialized: true });
    const unlisten = desktopBridge.subscribe((event) => get().handleEvent(event));
    void desktopBridge
      .getHostStatus()
      .then((hostStatus) => set({ hostStatus }))
      .catch((error: unknown) => set({ lastError: errorMessage(error) }));
    return () => {
      unlisten();
      set({ initialized: false });
    };
  },
}));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let persistenceTimer: ReturnType<typeof setTimeout> | undefined;

function preferencesFromState(state: WorkspaceState): WorkspacePreferences {
  return {
    theme: state.theme,
    selectedPresetId: state.selectedPresetId,
    parameters: state.parameters,
    overrides: state.overrides,
    output: state.output,
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

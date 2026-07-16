export const PRESET_IDS = ['cn', 'cn2', 'en_v1', 'en_v2'] as const;

export type PresetId = (typeof PRESET_IDS)[number];
export type InputOrigin = 'dialog' | 'drop' | 'paste' | 'manual';
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface InputSource {
  id: string;
  path: string;
  kind: 'file' | 'directory';
  origin: InputOrigin;
  valid: boolean;
  detail?: string;
}

export interface EditableParameters {
  beam_size: number;
  best_of: number;
  patience: number;
  temperature: number;
  no_speech_threshold: number;
  condition_on_previous_text: boolean;
}

export interface PresetDefinition {
  id: PresetId;
  label: string;
  language: '中文' | 'English';
  summary: string;
  parameters: EditableParameters;
}

export interface OutputPolicy {
  mode: 'compatibility' | 'custom';
  rootDirectory: string | null;
  txtEnabled: boolean;
  markdownEnabled: boolean;
  preserveSourceTxt: boolean;
  conflictPolicy: 'fail' | 'auto_rename';
}

export interface TaskSnapshot {
  id: string;
  title: string;
  sourceCount: number;
  presetId: PresetId;
  isCustom: boolean;
  status: TaskStatus;
  progress: number;
  stage: string;
  elapsed: string;
  createdAt: string;
  outputs?: string[];
  errorCode?: string;
  activeInput?: string;
  completedAt?: string;
  draft?: TranscriptionDraft;
}

export interface PerformanceSample {
  source: 'mock' | 'worker';
  gpu: number | null;
  vramUsed: number | null;
  vramTotal: number | null;
  cpu: number | null;
  memory: number | null;
  speed: number | null;
  memoryUsed?: number | null;
  memoryTotal?: number | null;
  gpuName?: string | null;
  timestamp?: number;
}

export interface OutputPreview {
  path: string;
  content: string;
  truncated: boolean;
}

export interface HostStatus {
  state: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';
  pid: number | null;
  launchKind: string | null;
  error: string | null;
}

export interface WorkerEnvironment {
  available: boolean;
  errors: string[];
  python: string;
  platform: string;
}

export interface ModelStatus {
  state: 'unloaded' | 'loading' | 'ready';
  modelId: string | null;
  device: string | null;
  computeType: string | null;
}

export interface TranscriptionDraft {
  inputs: InputSource[];
  basePresetId: PresetId;
  overrides: Partial<EditableParameters>;
  effectiveParameters: EditableParameters;
  output: OutputPolicy;
}

export type DesktopEvent =
  | { type: 'inputs.added'; inputs: InputSource[] }
  | { type: 'host.status'; status: HostStatus }
  | { type: 'worker.environment'; environment: WorkerEnvironment }
  | { type: 'worker.log'; line: string }
  | { type: 'worker.error'; code: string; message: string; taskId?: string }
  | { type: 'model.status'; model: ModelStatus }
  | { type: 'task.queued'; task: TaskSnapshot }
  | {
      type: 'task.progress';
      taskId: string;
      progress: number;
      stage: string;
      elapsed: string;
      inputPath?: string;
    }
  | { type: 'task.completed'; taskId: string; elapsed: string; outputs: string[] }
  | { type: 'task.failed'; taskId: string; code: string; message: string }
  | { type: 'task.cancelled'; taskId: string }
  | { type: 'performance.sample'; sample: PerformanceSample };

export type Unlisten = () => void;

export interface DesktopBridge {
  readonly mode: 'mock' | 'tauri';
  selectFiles(): Promise<InputSource[]>;
  selectDirectory(): Promise<InputSource[]>;
  selectOutputDirectory(): Promise<string | null>;
  inspectPaths(paths: string[], origin: InputOrigin): Promise<InputSource[]>;
  revealOutput(path: string): Promise<void>;
  readOutputPreview(path: string): Promise<OutputPreview>;
  getHostStatus(): Promise<HostStatus>;
  restartWorker(): Promise<HostStatus>;
  startTranscription(draft: TranscriptionDraft): Promise<{ taskId: string }>;
  cancelTask(taskId: string): Promise<void>;
  subscribe(listener: (event: DesktopEvent) => void): Unlisten;
  dispose(): void;
}

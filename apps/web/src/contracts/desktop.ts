export const PRESET_IDS = ['cn', 'cn2', 'en_v1', 'en_v2'] as const;
export const MODEL_IDS = ['tiny', 'base', 'small', 'medium', 'large-v3', 'large-v3-turbo'] as const;

export type PresetId = (typeof PRESET_IDS)[number];
export type ModelId = (typeof MODEL_IDS)[number];
export type ProfileMode = 'transcript' | 'subtitle';
export type InputOrigin = 'dialog' | 'drop' | 'paste' | 'manual';
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type HardwareMode = 'auto' | 'cuda' | 'cpu';
export type CudaComputeType = 'float16' | 'int8_float16' | 'float32';
export type CpuComputeType = 'int8' | 'float32';

export interface HardwarePreference {
  mode: HardwareMode;
  gpuDeviceIndex: number;
  cudaComputeType: CudaComputeType;
  cpuComputeType: CpuComputeType;
  cpuThreads: number;
}

export interface ResolvedHardware {
  device: 'cuda' | 'cpu';
  deviceIndex: number;
  computeType: string;
  cpuThreads: number;
}

export interface GpuCapability {
  index: number;
  name: string;
  computeTypes: string[];
}

export interface HardwareCapabilities {
  cpuName: string | null;
  cpuPhysicalCores: number;
  cpuLogicalCores: number;
  cpuComputeTypes: string[];
  gpus: GpuCapability[];
}

export interface InputSource {
  id: string;
  path: string;
  kind: 'file' | 'directory';
  origin: InputOrigin;
  valid: boolean;
  mediaCount?: number;
  detail?: string;
}

export interface EditableParameters {
  beam_size: number;
  best_of: number;
  patience: number;
  length_penalty: number;
  temperature: number;
  compression_ratio_threshold: number;
  log_prob_threshold: number;
  no_speech_threshold: number;
  condition_on_previous_text: boolean;
  min_silence_duration_ms: number;
}

export interface SubtitleParameters {
  max_characters_per_line: number;
  max_lines_per_cue: number;
  min_cue_duration_ms: number;
  max_cue_duration_ms: number;
  max_characters_per_second: number;
  cue_gap_ms: number;
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
  srtEnabled: boolean;
  preserveSourceTxt: boolean;
  preserveSourceMarkdown: boolean;
  conflictPolicy: 'confirm_overwrite' | 'auto_rename';
}

export interface TaskSnapshot {
  id: string;
  title: string;
  sourceCount: number;
  presetId: PresetId;
  modelId: ModelId;
  isCustom: boolean;
  status: TaskStatus;
  progress: number;
  stage: string;
  elapsed: string;
  createdAt: string;
  outputs?: string[];
  outputAvailability?: 'available' | 'missing';
  errorCode?: string;
  activeInput?: string;
  completedAt?: string;
  draft?: TranscriptionDraft;
  hardware?: ResolvedHardware;
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
  memoryAvailable?: number | null;
  swapUsed?: number | null;
  swapTotal?: number | null;
  workerRss?: number | null;
  workerThreadCount?: number | null;
  workerHandleCount?: number | null;
  cpuName?: string | null;
  cpuFrequencyMhz?: number | null;
  cpuPhysicalCores?: number | null;
  cpuLogicalCores?: number | null;
  systemProcessCount?: number | null;
  systemUptimeSeconds?: number | null;
  gpuName?: string | null;
  gpuMemoryController?: number | null;
  gpuTemperature?: number | null;
  gpuClockMhz?: number | null;
  gpuMemoryClockMhz?: number | null;
  gpuPowerWatts?: number | null;
  gpuPowerLimitWatts?: number | null;
  gpuFanPercent?: number | null;
  gpuDriverVersion?: string | null;
  gpuPerformanceState?: string | null;
  timestamp?: number;
}

export interface OutputPreview {
  path: string;
  content: string;
  truncated: boolean;
}

export interface OutputPathStatus {
  path: string;
  exists: boolean;
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
  hardware?: HardwareCapabilities;
}

export interface ModelStatus {
  state: 'unloaded' | 'loading' | 'ready';
  modelId: ModelId | null;
  device: string | null;
  computeType: string | null;
  deviceIndex: number | null;
  cpuThreads: number | null;
}

export interface LocalModelDescriptor {
  id: ModelId;
  label: string;
  installed: boolean;
  path: string | null;
  sizeBytes: number | null;
  detail: string;
}

export interface TranscriptionDraft {
  inputs: InputSource[];
  modelId: ModelId;
  basePresetId: PresetId;
  overrides: Partial<EditableParameters>;
  effectiveParameters: EditableParameters;
  profileMode: ProfileMode;
  subtitleParameters: SubtitleParameters;
  output: OutputPolicy;
  hardware: HardwarePreference;
}

export interface StartTranscriptionOptions {
  allowOverwrite?: boolean;
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
  inspectOutputPaths(paths: string[]): Promise<OutputPathStatus[]>;
  revealOutput(path: string): Promise<void>;
  readOutputPreview(path: string): Promise<OutputPreview>;
  copyWorkerLogs(content: string): Promise<void>;
  exportWorkerLogs(content: string): Promise<string | null>;
  getHostStatus(): Promise<HostStatus>;
  restartWorker(): Promise<HostStatus>;
  listLocalModels(): Promise<LocalModelDescriptor[]>;
  openModelDirectory(): Promise<string>;
  loadModel(modelId: ModelId, hardware?: HardwarePreference): Promise<void>;
  startTranscription(
    draft: TranscriptionDraft,
    options?: StartTranscriptionOptions,
  ): Promise<{ taskId: string }>;
  cancelTask(taskId: string): Promise<void>;
  subscribe(listener: (event: DesktopEvent) => void): Unlisten;
  dispose(): void;
}

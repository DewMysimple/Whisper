import {
  CALIBRATED_MODEL_IDS,
  DEFAULT_MODEL_ID,
  MODEL_IDS,
  SECONDARY_RECOGNITION_MODEL_IDS,
  TRANSLATION_MODEL_IDS,
  VISIBLE_MODEL_IDS,
} from './modelCatalog.generated';

export const PRESET_IDS = ['cn', 'cn2', 'en_v1', 'en_v2'] as const;

export {
  CALIBRATED_MODEL_IDS,
  DEFAULT_MODEL_ID,
  MODEL_IDS,
  SECONDARY_RECOGNITION_MODEL_IDS,
  TRANSLATION_MODEL_IDS,
  VISIBLE_MODEL_IDS,
};

export type PresetId = (typeof PRESET_IDS)[number];
export type ModelId = (typeof MODEL_IDS)[number];
export type V3ModelId = (typeof CALIBRATED_MODEL_IDS)[number];
export type TranscriptionTask = 'transcribe' | 'translate';
export type RecognitionStrategy = 'stable_primary' | 'mixed_zh_en' | 'zh_detail_review';
export type ProfileMode = 'transcript' | 'subtitle';
export type InputOrigin = 'dialog' | 'drop' | 'paste' | 'manual';
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type HardwareMode = 'auto' | 'cuda' | 'cpu';
export type CudaComputeType = 'float16' | 'int8_float16' | 'float32';
export type CpuComputeType = 'int8' | 'float32';
export type FinishAction = 'none' | 'shutdown';

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
  durationSeconds?: number;
  unknownDurationCount?: number;
  detail?: string;
}

export interface EditableParameters {
  task: TranscriptionTask;
  beam_size: number;
  best_of: number;
  patience: number;
  length_penalty: number;
  temperature: number;
  repetition_penalty: number;
  no_repeat_ngram_size: number;
  compression_ratio_threshold: number;
  log_prob_threshold: number;
  no_speech_threshold: number;
  condition_on_previous_text: boolean;
  prompt_reset_on_temperature: number;
  initial_prompt: string;
  hotwords: string;
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
  conflictPolicy: 'confirm_overwrite' | 'confirm_skip' | 'auto_rename';
}

export interface OutputConflictGroup {
  inputPath: string;
  paths: string[];
}

export type TaskMediaStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type QualityDiagnosticReason =
  'fallback_temperature' | 'low_log_probability' | 'high_compression_ratio' | 'silence_conflict';

export interface LowConfidenceSegment {
  index: number;
  start: number | null;
  end: number | null;
  text: string;
  temperature: number | null;
  avgLogProbability: number | null;
  compressionRatio: number | null;
  noSpeechProbability: number | null;
  reasons: QualityDiagnosticReason[];
}

export interface RecognitionQualityDiagnostics {
  detectedLanguage: string | null;
  languageProbability: number | null;
  segmentCount: number;
  fallbackSegmentCount: number;
  maxTemperature: number;
  lowConfidenceCount: number;
  segments: LowConfidenceSegment[];
  omittedSegmentCount?: number;
  recognitionStrategy?: RecognitionStrategy;
  languageRegions?: LanguageRegionDiagnostic[];
  secondaryPassCount?: number;
  replacedRegionCount?: number;
  reviewRegionCount?: number;
  rejectedRegionCount?: number;
  detailCandidates?: DetailCandidateDiagnostic[];
  hotwordAudit?: HotwordAudit;
}

export interface LanguageRegionDiagnostic {
  start: number;
  end: number;
  topLanguage: string;
  topProbability: number;
  englishProbability: number;
  chineseProbability: number;
  primaryText: string;
  candidateText: string;
  decision: 'primary' | 'replaced' | 'review' | 'rejected';
  reason: string | null;
}

export interface DetailCandidateDiagnostic {
  start: number;
  end: number;
  chineseProbability: number;
  primaryText: string;
  candidateText: string;
  decision: 'unchanged' | 'replaced' | 'review' | 'rejected';
  reason: string | null;
  primaryWordProbability: number | null;
  candidateWordProbability: number | null;
  primaryLogProbability: number | null;
  candidateLogProbability: number | null;
  recoveredHotwords: string[];
}

export interface HotwordAudit {
  termCount: number;
  matchedCount: number;
  missingCount: number;
  matchedTerms: string[];
  missingTerms: string[];
  omittedTermCount: number;
}

export interface TaskMediaSnapshot {
  path: string;
  status: TaskMediaStatus;
  progress: number | null;
  stage: string;
  elapsedSeconds: number;
  durationSeconds?: number | null;
  outputPaths?: string[];
  qualityDiagnostics?: RecognitionQualityDiagnostics;
}

export interface TaskSnapshot {
  id: string;
  title: string;
  sourceCount: number;
  presetId: PresetId;
  modelId: ModelId;
  recognitionStrategy?: RecognitionStrategy;
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
  mediaPaths?: string[];
  skippedMedia?: OutputConflictGroup[];
  processingCount?: number;
  currentMediaIndex?: number;
  taskElapsedSeconds?: number;
  totalMediaDurationSeconds?: number;
  unknownMediaDurationCount?: number;
  mediaStates?: TaskMediaSnapshot[];
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
  recognitionStrategy?: RecognitionStrategy;
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
  skipConflicts?: boolean;
  finishAction?: FinishAction;
}

export interface PowerCapabilities {
  shutdown: boolean;
}

export interface PowerActionStatus {
  state: 'idle' | 'armed' | 'countdown' | 'executing' | 'failed';
  action: Exclude<FinishAction, 'none'> | null;
  executeAtEpochMs: number | null;
  error: string | null;
}

export interface TaskFinishedNotice {
  status: 'completed' | 'failed' | 'cancelled';
  elapsed: string;
  detail: string;
}

export type DesktopEvent =
  | { type: 'inputs.added'; inputs: InputSource[] }
  | { type: 'host.status'; status: HostStatus }
  | { type: 'worker.environment'; environment: WorkerEnvironment }
  | { type: 'worker.log'; line: string }
  | { type: 'worker.logs_cleared' }
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
      mediaIndex?: number;
      mediaTotal?: number;
      mediaProgress?: number;
      mediaElapsedSeconds?: number;
      taskElapsedSeconds?: number;
      mediaStatus?: TaskMediaStatus;
      outputPaths?: string[];
      qualityDiagnostics?: RecognitionQualityDiagnostics;
    }
  | {
      type: 'task.completed';
      taskId: string;
      elapsed: string;
      outputs: string[];
      skippedMedia?: OutputConflictGroup[];
      successCount?: number;
      failureCount?: number;
    }
  | { type: 'task.failed'; taskId: string; code: string; message: string }
  | { type: 'task.cancelled'; taskId: string }
  | { type: 'power.action'; status: PowerActionStatus }
  | { type: 'performance.sample'; sample: PerformanceSample };

export type Unlisten = () => void;

export interface DesktopBridge {
  readonly mode: 'mock' | 'tauri';
  selectFiles(): Promise<InputSource[]>;
  selectDirectory(): Promise<InputSource[]>;
  selectOutputDirectory(): Promise<string | null>;
  readClipboardText(): Promise<string>;
  inspectPaths(paths: string[], origin: InputOrigin): Promise<InputSource[]>;
  inspectOutputPaths(paths: string[]): Promise<OutputPathStatus[]>;
  revealOutput(path: string): Promise<void>;
  openOutputDirectory(path: string): Promise<void>;
  readOutputPreview(path: string): Promise<OutputPreview>;
  copyWorkerLogs(content: string): Promise<void>;
  exportWorkerLogs(content: string): Promise<string | null>;
  clearWorkerLogs(): Promise<void>;
  getHostStatus(): Promise<HostStatus>;
  restartWorker(): Promise<HostStatus>;
  listLocalModels(): Promise<LocalModelDescriptor[]>;
  openModelDirectory(): Promise<string>;
  loadModel(modelId: ModelId, hardware?: HardwarePreference): Promise<void>;
  getPowerCapabilities(): Promise<PowerCapabilities>;
  getPowerActionStatus(): Promise<PowerActionStatus>;
  cancelPowerAction(): Promise<PowerActionStatus>;
  notifyTaskFinished(notice: TaskFinishedNotice): Promise<boolean>;
  notifyPowerCountdown(elapsed: string): Promise<boolean>;
  startTranscription(
    draft: TranscriptionDraft,
    options?: StartTranscriptionOptions,
  ): Promise<{ taskId: string }>;
  cancelTask(taskId: string): Promise<void>;
  subscribe(listener: (event: DesktopEvent) => void): Unlisten;
  dispose(): void;
}

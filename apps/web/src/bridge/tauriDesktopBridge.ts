import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { desktopDir, join } from '@tauri-apps/api/path';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { open, save } from '@tauri-apps/plugin-dialog';

import type {
  DesktopBridge,
  DesktopEvent,
  EditableParameters,
  HostStatus,
  HardwarePreference,
  InputOrigin,
  InputSource,
  LocalModelDescriptor,
  ModelId,
  ModelStatus,
  OutputPolicy,
  OutputPathStatus,
  OutputPreview,
  TaskSnapshot,
  TranscriptionDraft,
  Unlisten,
  WorkerEnvironment,
} from '../contracts/desktop';
import { MODEL_IDS } from '../contracts/desktop';
import { PERFORMANCE_POLL_INTERVAL_MS } from '../state/performanceWindow';

const MEDIA_EXTENSIONS = [
  'mp4',
  'mkv',
  'avi',
  'mov',
  'wmv',
  'flv',
  'webm',
  'm4v',
  'mpeg',
  'mpg',
  'mp3',
  'wav',
  'm4a',
  'aac',
  'ogg',
];
const MODEL_HEALTH_POLL_INTERVAL_MS = 5000;

interface InspectedInput {
  path: string;
  kind: 'file' | 'directory';
  origin: InputOrigin;
  valid: boolean;
  mediaCount: number | null;
  detail: string | null;
}

interface HostStartResult {
  requestId: string;
  taskId: string;
}

interface WorkerEnvelope {
  schema_version: 1;
  type: 'event' | 'error';
  request_id?: string;
  task_id?: string;
  event?: string;
  code?: string;
  data: Record<string, unknown>;
}

interface PendingTaskMetadata {
  title: string;
  sourceCount: number;
  presetId: TranscriptionDraft['basePresetId'];
  isCustom: boolean;
  createdAt: string;
  draft: TranscriptionDraft;
}

const STAGE_LABELS: Record<string, string> = {
  'input.validating': '校验输入',
  'input.discovering': '展开媒体文件',
  'model.loading': '准备本地模型',
  'transcription.running': 'GPU 转录中',
  'postprocess.running': '文本后处理',
  'output.writing': '写入输出',
  'task.finalizing': '汇总任务结果',
};

const ERROR_LABELS: Record<string, string> = {
  'request.invalid': '任务配置无效',
  'task.not_found': '任务不存在或已经结束',
  'task.conflict': '任务或输出目标冲突',
  'worker.busy': '推理 Worker 正忙',
  'worker.internal': '推理 Worker 内部错误',
  'environment.unavailable': '本地推理环境不可用',
  'model.load_failed': '本地模型加载失败',
  'transcription.failed': '转录失败',
  'output.failed': '输出规划或写入失败',
  'host.worker_not_ready': '桌面推理 Worker 尚未就绪',
  'host.worker_disconnected': '桌面推理 Worker 已断开',
  'host.protocol_invalid': 'Worker 返回了无效协议消息',
};

export class TauriDesktopBridge implements DesktopBridge {
  readonly mode = 'tauri' as const;

  private readonly listeners = new Set<(event: DesktopEvent) => void>();
  private readonly nativeUnlisteners: UnlistenFn[] = [];
  private readonly pendingTasks = new Map<string, PendingTaskMetadata>();
  private readonly taskStartedAt = new Map<string, number>();
  private nativeSetup: Promise<void> | undefined;
  private performanceTimer: ReturnType<typeof setInterval> | undefined;
  private modelHealthTimer: ReturnType<typeof setInterval> | undefined;
  private performancePolling = false;
  private inputSequence = 1;
  private lastReadyPid: number | null = null;
  private lastModelStatus: ModelStatus = {
    state: 'unloaded',
    modelId: null,
    device: null,
    computeType: null,
    deviceIndex: null,
    cpuThreads: null,
  };

  async selectFiles(): Promise<InputSource[]> {
    await this.ensureNativeListeners();
    const selected = await open({
      title: '选择需要转录的媒体文件',
      multiple: true,
      directory: false,
      filters: [{ name: '支持的媒体文件', extensions: MEDIA_EXTENSIONS }],
    });
    return this.inspectPaths(normalizeDialogPaths(selected), 'dialog');
  }

  async selectDirectory(): Promise<InputSource[]> {
    await this.ensureNativeListeners();
    const selected = await open({
      title: '选择包含媒体的文件夹',
      multiple: false,
      directory: true,
    });
    return this.inspectPaths(normalizeDialogPaths(selected), 'dialog');
  }

  async selectOutputDirectory(): Promise<string | null> {
    await this.ensureNativeListeners();
    const selected = await open({
      title: '选择字幕输出根目录',
      multiple: false,
      directory: true,
    });
    return typeof selected === 'string' ? selected : null;
  }

  async inspectPaths(paths: string[], origin: InputOrigin): Promise<InputSource[]> {
    if (paths.length === 0) return [];
    const inspected = await invoke<InspectedInput[]>('inspect_inputs', { paths, origin });
    return inspected.map((item) => ({
      ...item,
      mediaCount: item.mediaCount ?? undefined,
      detail: item.detail ?? undefined,
      id: `native-source-${this.inputSequence++}`,
    }));
  }

  async inspectOutputPaths(paths: string[]): Promise<OutputPathStatus[]> {
    if (paths.length === 0) return [];
    return invoke<OutputPathStatus[]>('inspect_output_paths', { paths });
  }

  async revealOutput(path: string): Promise<void> {
    await invoke('reveal_output', { path });
  }

  async readOutputPreview(path: string): Promise<OutputPreview> {
    return invoke<OutputPreview>('read_output_preview', { path });
  }

  async copyWorkerLogs(content: string): Promise<void> {
    await writeText(content);
  }

  async exportWorkerLogs(content: string): Promise<string | null> {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const defaultPath = await join(await desktopDir(), `WhisperSubtitle-WorkerLog-${stamp}.txt`);
    const selected = await save({
      title: '导出 Worker 日志',
      defaultPath,
      filters: [{ name: 'UTF-8 文本文档', extensions: ['txt'] }],
    });
    if (selected === null) return null;
    return invoke<string>('write_worker_log_export', { path: selected, content });
  }

  async getHostStatus(): Promise<HostStatus> {
    await this.ensureNativeListeners();
    return invoke<HostStatus>('get_host_status');
  }

  async restartWorker(): Promise<HostStatus> {
    await this.ensureNativeListeners();
    const status = await invoke<HostStatus>('restart_worker');
    this.handleHostStatus(status);
    return status;
  }

  async listLocalModels(): Promise<LocalModelDescriptor[]> {
    await this.ensureNativeListeners();
    return invoke<LocalModelDescriptor[]>('list_local_models');
  }

  async openModelDirectory(): Promise<string> {
    await this.ensureNativeListeners();
    return invoke<string>('open_model_directory');
  }

  async loadModel(modelId: ModelId, hardware?: HardwarePreference): Promise<void> {
    await this.ensureNativeListeners();
    await invoke('load_model', { modelId, hardware: toHostHardware(hardware) });
  }

  async startTranscription(
    draft: TranscriptionDraft,
    options: { allowOverwrite?: boolean } = {},
  ): Promise<{ taskId: string }> {
    await this.ensureNativeListeners();
    const requestId = createRequestId();
    this.pendingTasks.set(requestId, createTaskMetadata(draft));
    try {
      const result = await invoke<HostStartResult>('start_transcription', {
        draft: {
          requestId,
          modelId: draft.modelId,
          inputs: draft.inputs.map(({ path, kind, origin }) => ({ path, kind, origin })),
          basePresetId: draft.basePresetId,
          overrides: draft.overrides,
          hardware: toHostHardware(draft.hardware),
          output: toHostOutput(
            draft.output,
            draft.subtitleParameters,
            options.allowOverwrite === true,
          ),
        },
      });
      return { taskId: result.taskId };
    } catch (error) {
      this.pendingTasks.delete(requestId);
      const normalized = normalizeInvokeError(error);
      const paths = outputConflictPaths(normalized.data);
      if (normalized.code === 'output.failed' && paths !== null) {
        throw Object.assign(new Error('检测到同名输出文件。'), {
          code: 'output.conflict',
          paths,
        });
      }
      throw normalized;
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    await this.ensureNativeListeners();
    await invoke('cancel_transcription', { taskId });
  }

  subscribe(listener: (event: DesktopEvent) => void): Unlisten {
    this.listeners.add(listener);
    void this.ensureNativeListeners().catch((error: unknown) => {
      const normalized = normalizeInvokeError(error);
      this.emit({ type: 'worker.error', code: normalized.code, message: normalized.message });
    });
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    for (const unlisten of this.nativeUnlisteners.splice(0)) unlisten();
    this.listeners.clear();
    this.pendingTasks.clear();
    this.taskStartedAt.clear();
    if (this.performanceTimer !== undefined) clearInterval(this.performanceTimer);
    if (this.modelHealthTimer !== undefined) clearInterval(this.modelHealthTimer);
    this.performanceTimer = undefined;
    this.modelHealthTimer = undefined;
    this.nativeSetup = undefined;
  }

  private ensureNativeListeners(): Promise<void> {
    this.nativeSetup ??= this.setupNativeListeners();
    return this.nativeSetup;
  }

  private async setupNativeListeners(): Promise<void> {
    this.nativeUnlisteners.push(
      await listen<HostStatus>('desktop://host-status', ({ payload }) =>
        this.handleHostStatus(payload),
      ),
      await listen<WorkerEnvelope>('desktop://worker-message', ({ payload }) =>
        this.handleWorkerMessage(payload),
      ),
      await listen<{ line: string }>('desktop://worker-log', ({ payload }) =>
        this.emit({ type: 'worker.log', line: payload.line }),
      ),
      await getCurrentWebviewWindow().onDragDropEvent((event) => {
        if (event.payload.type === 'drop') {
          void this.inspectPaths(event.payload.paths, 'drop')
            .then((inputs) => this.emit({ type: 'inputs.added', inputs }))
            .catch((error: unknown) => {
              const normalized = normalizeInvokeError(error);
              this.emit({
                type: 'worker.error',
                code: normalized.code,
                message: normalized.message,
              });
            });
        }
      }),
    );
    const status = await invoke<HostStatus>('get_host_status');
    this.handleHostStatus(status);
    const existingLogs = await invoke<string[]>('get_worker_logs');
    if (Array.isArray(existingLogs)) {
      existingLogs.forEach((line) => this.emit({ type: 'worker.log', line }));
    }
    await this.refreshPerformance();
    await this.refreshModelHealth();
    this.performanceTimer = setInterval(
      () => void this.refreshPerformance(),
      PERFORMANCE_POLL_INTERVAL_MS,
    );
    this.modelHealthTimer = setInterval(
      () => void this.refreshModelHealth(),
      MODEL_HEALTH_POLL_INTERVAL_MS,
    );
  }

  private handleHostStatus(status: HostStatus): void {
    this.emit({ type: 'host.status', status });
    if (status.state === 'ready' && status.pid !== this.lastReadyPid) {
      this.lastReadyPid = status.pid;
      void this.refreshEnvironment();
    }
    if (status.state !== 'ready') this.lastReadyPid = null;
    if (status.state !== 'ready' && this.lastModelStatus.state !== 'unloaded') {
      this.emitModelStatus({
        state: 'unloaded',
        modelId: null,
        device: null,
        computeType: null,
        deviceIndex: null,
        cpuThreads: null,
      });
    }
  }

  private async refreshEnvironment(): Promise<void> {
    try {
      const envelope = await invoke<WorkerEnvelope>('worker_environment');
      const result = envelope.data.result;
      if (isWorkerEnvironment(result)) {
        this.emit({
          type: 'worker.environment',
          environment: {
            ...result,
            hardware: readHardwareCapabilities(result.hardware),
          },
        });
      }
    } catch (error) {
      const normalized = normalizeInvokeError(error);
      this.emit({ type: 'worker.error', code: normalized.code, message: normalized.message });
    }
  }

  private async refreshPerformance(): Promise<void> {
    if (this.lastReadyPid === null || this.performancePolling) return;
    this.performancePolling = true;
    try {
      const envelope = await invoke<WorkerEnvelope>('worker_metrics');
      const result = envelope.data.result;
      if (isPerformanceResult(result)) {
        this.emit({
          type: 'performance.sample',
          sample: {
            source: 'worker',
            gpu: result.gpu_percent,
            vramUsed: result.vram_used_gib,
            vramTotal: result.vram_total_gib,
            cpu: result.cpu_percent,
            memory: result.memory_percent,
            speed: null,
            memoryUsed: result.memory_used_gib,
            memoryTotal: result.memory_total_gib,
            memoryAvailable: result.memory_available_gib ?? null,
            swapUsed: result.swap_used_gib ?? null,
            swapTotal: result.swap_total_gib ?? null,
            workerRss: result.worker_rss_gib ?? null,
            workerThreadCount: result.worker_thread_count ?? null,
            workerHandleCount: result.worker_handle_count ?? null,
            cpuName: result.cpu_name ?? null,
            cpuFrequencyMhz: result.cpu_frequency_mhz ?? null,
            cpuPhysicalCores: result.cpu_physical_cores ?? null,
            cpuLogicalCores: result.cpu_logical_cores ?? null,
            systemProcessCount: result.system_process_count ?? null,
            systemUptimeSeconds: result.system_uptime_seconds ?? null,
            gpuName: result.gpu_name,
            gpuMemoryController: result.gpu_memory_controller_percent ?? null,
            gpuTemperature: result.gpu_temperature_c ?? null,
            gpuClockMhz: result.gpu_clock_mhz ?? null,
            gpuMemoryClockMhz: result.gpu_memory_clock_mhz ?? null,
            gpuPowerWatts: result.gpu_power_watts ?? null,
            gpuPowerLimitWatts: result.gpu_power_limit_watts ?? null,
            gpuFanPercent: result.gpu_fan_percent ?? null,
            gpuDriverVersion: result.gpu_driver_version ?? null,
            gpuPerformanceState: result.gpu_performance_state ?? null,
            timestamp: result.timestamp_ms,
          },
        });
      }
    } catch {
      // Metrics are diagnostic only. Worker lifecycle errors arrive through
      // the dedicated status/error channels and must not create poll noise.
    } finally {
      this.performancePolling = false;
    }
  }

  private async refreshModelHealth(): Promise<void> {
    if (this.lastReadyPid === null) return;
    try {
      const envelope = await invoke<WorkerEnvelope>('worker_health');
      const result = envelope.data.result;
      if (!isRecord(result)) return;
      if (result.model_loaded === false) {
        if (this.lastModelStatus.state !== 'unloaded') {
          this.emitModelStatus({
            state: 'unloaded',
            modelId: null,
            device: null,
            computeType: null,
            deviceIndex: null,
            cpuThreads: null,
          });
        }
        return;
      }
      if (result.model_loaded === true && isModelId(result.model_id)) {
        const sameModel = this.lastModelStatus.modelId === result.model_id;
        const hardware = readResolvedHardware(result.hardware);
        const sameHardware =
          hardware === undefined ||
          (this.lastModelStatus.device === hardware.device &&
            this.lastModelStatus.computeType === hardware.computeType &&
            this.lastModelStatus.deviceIndex === hardware.deviceIndex &&
            this.lastModelStatus.cpuThreads === hardware.cpuThreads);
        if (!sameModel || !sameHardware || this.lastModelStatus.state !== 'ready') {
          this.emitModelStatus({
            state: 'ready',
            modelId: result.model_id,
            device: hardware?.device ?? (sameModel ? this.lastModelStatus.device : null),
            computeType:
              hardware?.computeType ?? (sameModel ? this.lastModelStatus.computeType : null),
            deviceIndex:
              hardware?.deviceIndex ?? (sameModel ? this.lastModelStatus.deviceIndex : null),
            cpuThreads:
              hardware?.cpuThreads ?? (sameModel ? this.lastModelStatus.cpuThreads : null),
          });
        }
      }
    } catch {
      // Health correction is best-effort; lifecycle events remain authoritative.
    }
  }

  private handleWorkerMessage(message: WorkerEnvelope): void {
    if (message.type === 'error') {
      const code = message.code ?? 'worker.error';
      if (
        code === 'output.failed' &&
        message.request_id !== undefined &&
        this.pendingTasks.has(message.request_id) &&
        outputConflictPaths(message.data) !== null
      ) {
        return;
      }
      this.emit({
        type: 'worker.error',
        code,
        message: ERROR_LABELS[code] ?? 'Worker 拒绝了桌面命令',
        taskId: message.task_id,
      });
      return;
    }
    switch (message.event) {
      case 'model.loading':
        if (!isModelId(message.data.model_id)) break;
        this.emitModelStatus({
          state: 'loading',
          modelId: message.data.model_id,
          device: null,
          computeType: null,
          deviceIndex: null,
          cpuThreads: null,
        });
        break;
      case 'model.ready':
        if (!isModelId(message.data.model_id)) break;
        this.emitModelStatus({
          state: 'ready',
          modelId: message.data.model_id,
          device: readString(message.data.device),
          computeType: readString(message.data.compute_type),
          deviceIndex: readNumber(message.data.device_index),
          cpuThreads: readNumber(message.data.cpu_threads),
        });
        break;
      case 'task.queued':
        this.handleTaskQueued(message);
        break;
      case 'task.progress':
        this.handleTaskProgress(message);
        break;
      case 'task.completed':
        this.handleTaskCompleted(message);
        break;
      case 'task.failed':
        this.handleTaskFailed(message);
        break;
      case 'task.cancelled':
        if (message.task_id) {
          this.emit({ type: 'task.cancelled', taskId: message.task_id });
          this.taskStartedAt.delete(message.task_id);
        }
        break;
    }
  }

  private handleTaskQueued(message: WorkerEnvelope): void {
    if (!message.task_id) return;
    const metadata = message.request_id ? this.pendingTasks.get(message.request_id) : undefined;
    const task: TaskSnapshot = {
      id: message.task_id,
      title: metadata?.title ?? `本地任务 ${message.task_id.slice(-8)}`,
      sourceCount: readNumber(message.data.input_count) ?? metadata?.sourceCount ?? 1,
      presetId: metadata?.presetId ?? 'en_v1',
      modelId: isModelId(message.data.model_id)
        ? message.data.model_id
        : (metadata?.draft.modelId ?? 'large-v3-turbo'),
      isCustom: metadata?.isCustom ?? false,
      status: 'queued',
      progress: 0,
      stage: '已进入本地队列',
      elapsed: '00:00',
      createdAt: metadata?.createdAt ?? currentTimestamp(),
      draft: metadata?.draft,
      hardware: readResolvedHardware(message.data.hardware),
    };
    if (message.request_id) this.pendingTasks.delete(message.request_id);
    this.taskStartedAt.set(message.task_id, Date.now());
    this.emit({ type: 'task.queued', task });
  }

  private handleTaskProgress(message: WorkerEnvelope): void {
    if (!message.task_id) return;
    const stage = readString(message.data.stage) ?? 'transcription.running';
    const current = readNumber(message.data.current) ?? 0;
    const total = readNumber(message.data.total) ?? 0;
    this.emit({
      type: 'task.progress',
      taskId: message.task_id,
      progress: progressForStage(stage, current, total),
      stage: STAGE_LABELS[stage] ?? stage,
      elapsed: this.elapsedFor(message.task_id),
      inputPath: readString(message.data.input_path) ?? undefined,
    });
  }

  private handleTaskCompleted(message: WorkerEnvelope): void {
    if (!message.task_id) return;
    const outputs = Array.isArray(message.data.outputs)
      ? message.data.outputs.filter((item): item is string => typeof item === 'string')
      : [];
    this.emit({
      type: 'task.completed',
      taskId: message.task_id,
      elapsed: this.elapsedFor(message.task_id),
      outputs,
    });
    this.taskStartedAt.delete(message.task_id);
  }

  private handleTaskFailed(message: WorkerEnvelope): void {
    if (!message.task_id) return;
    const code = readString(message.data.error_code) ?? 'transcription.failed';
    this.emit({
      type: 'task.failed',
      taskId: message.task_id,
      code,
      message: ERROR_LABELS[code] ?? '本地转录任务失败',
    });
    this.taskStartedAt.delete(message.task_id);
  }

  private elapsedFor(taskId: string): string {
    const startedAt = this.taskStartedAt.get(taskId) ?? Date.now();
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes.toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  }

  private emit(event: DesktopEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private emitModelStatus(model: ModelStatus): void {
    this.lastModelStatus = model;
    this.emit({ type: 'model.status', model });
  }
}

function normalizeDialogPaths(value: string | string[] | null): string[] {
  if (value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function createRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? `${Date.now()}`;
  return `desktop-${random}`;
}

function isModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && MODEL_IDS.includes(value as ModelId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createTaskMetadata(draft: TranscriptionDraft): PendingTaskMetadata {
  const title =
    draft.inputs.length === 1
      ? (draft.inputs[0]?.path.split(/[/\\]/).at(-1) ?? '本地转录任务')
      : `${draft.inputs.length} 个输入来源`;
  return {
    title,
    sourceCount: draft.inputs.length,
    presetId: draft.basePresetId,
    isCustom: Object.keys(draft.overrides).length > 0,
    createdAt: currentTimestamp(),
    draft: structuredClone(draft),
  };
}

function toHostHardware(hardware: HardwarePreference | undefined) {
  if (hardware === undefined) return undefined;
  return {
    mode: hardware.mode,
    gpuDeviceIndex: hardware.gpuDeviceIndex,
    cudaComputeType: hardware.cudaComputeType,
    cpuComputeType: hardware.cpuComputeType,
    cpuThreads: hardware.cpuThreads,
  };
}

function toHostOutput(
  output: OutputPolicy,
  subtitle: TranscriptionDraft['subtitleParameters'],
  allowOverwrite = false,
) {
  return {
    mode: output.mode,
    rootDirectory: output.mode === 'custom' ? output.rootDirectory : null,
    txtEnabled: output.txtEnabled,
    markdownEnabled: output.markdownEnabled,
    srtEnabled: output.srtEnabled,
    preserveSourceTxt: output.preserveSourceTxt,
    preserveSourceMarkdown: output.preserveSourceMarkdown,
    conflictPolicy:
      output.conflictPolicy === 'auto_rename'
        ? 'auto_rename'
        : allowOverwrite
          ? 'overwrite'
          : 'fail',
    subtitle: {
      maxCharactersPerLine: subtitle.max_characters_per_line,
      maxLinesPerCue: subtitle.max_lines_per_cue,
      minCueDurationMs: subtitle.min_cue_duration_ms,
      maxCueDurationMs: subtitle.max_cue_duration_ms,
      maxCharactersPerSecond: subtitle.max_characters_per_second,
      cueGapMs: subtitle.cue_gap_ms,
    },
  };
}

function progressForStage(stage: string, current: number, total: number): number {
  const ratio = total > 0 ? Math.min(1, current / total) : 0;
  const ranges: Record<string, [number, number]> = {
    'input.validating': [2, 5],
    'input.discovering': [6, 10],
    'model.loading': [11, 18],
    'transcription.running': [19, 78],
    'postprocess.running': [79, 88],
    'output.writing': [89, 96],
    'task.finalizing': [97, 99],
  };
  const [start, end] = ranges[stage] ?? [1, 99];
  return Math.round(start + (end - start) * ratio);
}

function currentTimestamp(): string {
  return new Date().toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readResolvedHardware(value: unknown): TaskSnapshot['hardware'] {
  if (!isRecord(value)) return undefined;
  const device = value.device;
  const deviceIndex = readNumber(value.device_index);
  const computeType = readString(value.compute_type);
  const cpuThreads = readNumber(value.cpu_threads);
  if (
    (device !== 'cuda' && device !== 'cpu') ||
    deviceIndex === null ||
    computeType === null ||
    cpuThreads === null
  ) {
    return undefined;
  }
  return { device, deviceIndex, computeType, cpuThreads };
}

function isWorkerEnvironment(value: unknown): value is WorkerEnvironment {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.available === 'boolean' &&
    Array.isArray(candidate.errors) &&
    candidate.errors.every((item) => typeof item === 'string') &&
    typeof candidate.python === 'string' &&
    typeof candidate.platform === 'string' &&
    (candidate.hardware === undefined ||
      candidate.hardware === null ||
      readHardwareCapabilities(candidate.hardware) !== undefined)
  );
}

function readHardwareCapabilities(value: unknown): WorkerEnvironment['hardware'] {
  if (!isRecord(value)) return undefined;
  if (
    (value.cpu_name !== null && typeof value.cpu_name !== 'string') ||
    typeof value.cpu_physical_cores !== 'number' ||
    typeof value.cpu_logical_cores !== 'number' ||
    !Array.isArray(value.cpu_compute_types) ||
    !Array.isArray(value.gpus)
  ) {
    return undefined;
  }
  if (!(
    value.cpu_compute_types.every((item) => typeof item === 'string') &&
    value.gpus.every(
      (item) =>
        isRecord(item) &&
        typeof item.index === 'number' &&
        typeof item.name === 'string' &&
        Array.isArray(item.compute_types) &&
        item.compute_types.every((type) => typeof type === 'string'),
    )
  ))
    return undefined;
  return {
    cpuName: value.cpu_name as string | null,
    cpuPhysicalCores: value.cpu_physical_cores as number,
    cpuLogicalCores: value.cpu_logical_cores as number,
    cpuComputeTypes: value.cpu_compute_types as string[],
    gpus: (value.gpus as Array<Record<string, unknown>>).map((item) => ({
      index: item.index as number,
      name: item.name as string,
      computeTypes: item.compute_types as string[],
    })),
  };
}

interface PerformanceResult {
  timestamp_ms: number;
  cpu_percent: number;
  memory_percent: number;
  memory_used_gib: number;
  memory_total_gib: number;
  gpu_percent: number | null;
  vram_used_gib: number | null;
  vram_total_gib: number | null;
  gpu_name: string | null;
  memory_available_gib?: number | null;
  swap_used_gib?: number | null;
  swap_total_gib?: number | null;
  worker_rss_gib?: number | null;
  worker_thread_count?: number | null;
  worker_handle_count?: number | null;
  cpu_name?: string | null;
  cpu_frequency_mhz?: number | null;
  cpu_physical_cores?: number | null;
  cpu_logical_cores?: number | null;
  system_process_count?: number | null;
  system_uptime_seconds?: number | null;
  gpu_memory_controller_percent?: number | null;
  gpu_temperature_c?: number | null;
  gpu_clock_mhz?: number | null;
  gpu_memory_clock_mhz?: number | null;
  gpu_power_watts?: number | null;
  gpu_power_limit_watts?: number | null;
  gpu_fan_percent?: number | null;
  gpu_driver_version?: string | null;
  gpu_performance_state?: string | null;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isPerformanceResult(value: unknown): value is PerformanceResult {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  const optionalNumbers = [
    'memory_available_gib',
    'swap_used_gib',
    'swap_total_gib',
    'worker_rss_gib',
    'worker_thread_count',
    'worker_handle_count',
    'cpu_frequency_mhz',
    'cpu_physical_cores',
    'cpu_logical_cores',
    'system_process_count',
    'system_uptime_seconds',
    'gpu_memory_controller_percent',
    'gpu_temperature_c',
    'gpu_clock_mhz',
    'gpu_memory_clock_mhz',
    'gpu_power_watts',
    'gpu_power_limit_watts',
    'gpu_fan_percent',
  ];
  const optionalStrings = ['cpu_name', 'gpu_driver_version', 'gpu_performance_state'];
  return (
    typeof item.timestamp_ms === 'number' &&
    typeof item.cpu_percent === 'number' &&
    typeof item.memory_percent === 'number' &&
    typeof item.memory_used_gib === 'number' &&
    typeof item.memory_total_gib === 'number' &&
    isNullableNumber(item.gpu_percent) &&
    isNullableNumber(item.vram_used_gib) &&
    isNullableNumber(item.vram_total_gib) &&
    (item.gpu_name === null || typeof item.gpu_name === 'string') &&
    optionalNumbers.every((key) => item[key] === undefined || isNullableNumber(item[key])) &&
    optionalStrings.every(
      (key) => item[key] === undefined || item[key] === null || typeof item[key] === 'string',
    )
  );
}

function outputConflictPaths(data: unknown): string[] | null {
  if (!isRecord(data) || data.exception !== 'OutputConflictError' || !Array.isArray(data.paths)) {
    return null;
  }
  const paths = data.paths.filter((item): item is string => typeof item === 'string');
  return paths.length > 0 ? paths : null;
}

function normalizeInvokeError(error: unknown): Error & { code: string; data?: unknown } {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>;
    const code = typeof candidate.code === 'string' ? candidate.code : 'host.command_failed';
    const message =
      typeof candidate.message === 'string'
        ? candidate.message
        : (ERROR_LABELS[code] ?? '桌面命令执行失败');
    return Object.assign(new Error(message), { code, data: candidate.data });
  }
  return Object.assign(new Error(String(error)), { code: 'host.command_failed' });
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export type { EditableParameters, ModelStatus };

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { desktopDir, join } from '@tauri-apps/api/path';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
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
  OutputPathStatus,
  OutputPreview,
  PowerActionStatus,
  PowerCapabilities,
  StartTranscriptionOptions,
  TranscriptionDraft,
  Unlisten,
} from '../contracts/desktop';
import { PERFORMANCE_POLL_INTERVAL_MS } from '../state/performanceWindow';
import { TaskProgressTracker } from './taskProgress';

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

import {
  createRequestId,
  createTaskMetadata,
  isModelId,
  isPerformanceResult,
  isRecord,
  isWorkerEnvironment,
  normalizeDialogPaths,
  normalizeInvokeError,
  outputConflictDetails,
  readHardwareCapabilities,
  readResolvedHardware,
  toHostHardware,
  toHostOutput,
  type PendingTaskMetadata,
} from './tauriWorkerDecoder';
import {
  handleWorkerMessage as dispatchWorkerMessage,
  type WorkerEnvelope,
} from './tauriWorkerEvents';
interface InspectedInput {
  path: string;
  kind: 'file' | 'directory';
  origin: InputOrigin;
  valid: boolean;
  mediaCount: number | null;
  durationSeconds: number | null;
  unknownDurationCount: number | null;
  detail: string | null;
}

interface HostStartResult {
  requestId: string;
  taskId: string;
}

export class TauriDesktopBridge implements DesktopBridge {
  readonly mode = 'tauri' as const;

  private readonly listeners = new Set<(event: DesktopEvent) => void>();
  private readonly nativeUnlisteners: UnlistenFn[] = [];
  private readonly pendingTasks = new Map<string, PendingTaskMetadata>();
  private readonly taskStartedAt = new Map<string, number>();
  private readonly taskProgress = new TaskProgressTracker();
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

  async readClipboardText(): Promise<string> {
    await this.ensureNativeListeners();
    return readText();
  }

  async inspectPaths(paths: string[], origin: InputOrigin): Promise<InputSource[]> {
    if (paths.length === 0) return [];
    const inspected = await invoke<InspectedInput[]>('inspect_inputs', { paths, origin });
    return inspected.map((item) => ({
      ...item,
      mediaCount: item.mediaCount ?? undefined,
      durationSeconds: item.durationSeconds ?? undefined,
      unknownDurationCount: item.unknownDurationCount ?? undefined,
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

  async openOutputDirectory(path: string): Promise<void> {
    await invoke('open_output_directory', { path });
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

  async clearWorkerLogs(): Promise<void> {
    await invoke('clear_worker_logs');
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

  async getPowerCapabilities(): Promise<PowerCapabilities> {
    await this.ensureNativeListeners();
    return invoke<PowerCapabilities>('get_power_capabilities');
  }

  async getPowerActionStatus(): Promise<PowerActionStatus> {
    await this.ensureNativeListeners();
    return invoke<PowerActionStatus>('get_power_action_status');
  }

  async cancelPowerAction(): Promise<PowerActionStatus> {
    await this.ensureNativeListeners();
    return invoke<PowerActionStatus>('cancel_power_action');
  }

  async startTranscription(
    draft: TranscriptionDraft,
    options: StartTranscriptionOptions = {},
  ): Promise<{ taskId: string }> {
    await this.ensureNativeListeners();
    const requestId = createRequestId();
    this.pendingTasks.set(requestId, createTaskMetadata(draft));
    try {
      const result = await invoke<HostStartResult>('start_transcription', {
        draft: {
          requestId,
          modelId: draft.modelId,
          recognitionStrategy: draft.recognitionStrategy ?? 'stable_primary',
          finishAction:
            options.finishAction === undefined || options.finishAction === 'none'
              ? undefined
              : options.finishAction,
          inputs: draft.inputs.map(({ path, kind, origin }) => ({ path, kind, origin })),
          basePresetId: draft.basePresetId,
          overrides: draft.overrides,
          hardware: toHostHardware(draft.hardware),
          output: toHostOutput(
            draft.output,
            draft.subtitleParameters,
            options.allowOverwrite === true,
            options.skipConflicts === true,
          ),
        },
      });
      return { taskId: result.taskId };
    } catch (error) {
      this.pendingTasks.delete(requestId);
      const normalized = normalizeInvokeError(error);
      const conflict = outputConflictDetails(normalized.data);
      if (normalized.code === 'output.failed' && conflict !== null) {
        throw Object.assign(new Error('检测到同名输出文件。'), {
          code: 'output.conflict',
          ...conflict,
        });
      }
      if (
        normalized.code === 'output.failed' &&
        isRecord(normalized.data) &&
        normalized.data.exception === 'AllOutputsSkipped'
      ) {
        throw Object.assign(new Error('所有媒体均已有同名输出，本次没有创建任务。'), {
          code: 'output.all_skipped',
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
    this.taskProgress.clear();
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
      await listen('desktop://worker-logs-cleared', () =>
        this.emit({ type: 'worker.logs_cleared' }),
      ),
      await listen<PowerActionStatus>('desktop://power-action', ({ payload }) =>
        this.emit({ type: 'power.action', status: payload }),
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
    dispatchWorkerMessage(message, {
      pendingTasks: this.pendingTasks,
      taskStartedAt: this.taskStartedAt,
      taskProgress: this.taskProgress,
      emit: (event) => this.emit(event),
      emitModelStatus: (model) => this.emitModelStatus(model),
    });
  }

  private emit(event: DesktopEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private emitModelStatus(model: ModelStatus): void {
    this.lastModelStatus = model;
    this.emit({ type: 'model.status', model });
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export type { EditableParameters, ModelStatus };

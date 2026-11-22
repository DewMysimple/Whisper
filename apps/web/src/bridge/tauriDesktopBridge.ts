import { Channel, invoke } from '@tauri-apps/api/core';
import { readHardwareCapabilities } from '../state/executionOptions';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { desktopDir, join } from '@tauri-apps/api/path';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { open, save } from '@tauri-apps/plugin-dialog';

import type {
  DesktopBridge,
  DesktopEvent,
  EditableParameters,
  HostStatus,
  InputInspectionOptions,
  InputInspectionProgress,
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
  TaskFinishedNotice,
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
declare const __FRONTEND_BUILD__: { revision: string | null; builtAt: string | null };

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
  readResolvedHardware,
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
  errorCode?: string | null;
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
  private readonly preparing = new Map<string, StartTranscriptionOptions>();
  private readonly taskClickTimes = new Map<string, number>();
  private readonly taskStartedAt = new Map<string, number>();
  private readonly taskProgress = new TaskProgressTracker();
  private nativeSetup: Promise<void> | undefined;
  private dragSetup: Promise<UnlistenFn | undefined> | undefined;
  private performanceTimer: ReturnType<typeof setInterval> | undefined;
  private modelHealthTimer: ReturnType<typeof setInterval> | undefined;
  private performancePolling = false;
  private modelHealthPolling = false;
  private disposed = false;
  private hostRevision = 0;
  private inputSequence = 1;
  private lastReadyPid: number | null = null;
  private canCancelStart = false;
  private lastModelStatus: ModelStatus = {
    state: 'unloaded',
    modelId: null,
    device: null,
    computeType: null,
    deviceIndex: null,
    cpuThreads: null,
  };

  async selectFiles(): Promise<InputSource[]> {
    return this.inspectPaths(await this.pickInputPaths('file'), 'dialog');
  }

  async selectDirectory(): Promise<InputSource[]> {
    return this.inspectPaths(await this.pickInputPaths('directory'), 'dialog');
  }

  async pickInputPaths(kind: InputSource['kind']): Promise<string[]> {
    await this.ensureNativeListeners();
    const directory = kind === 'directory';
    const selected = await open({
      title: directory ? '选择包含媒体的文件夹' : '选择需要转录的媒体文件',
      multiple: !directory,
      directory,
      filters: directory ? undefined : [{ name: '支持的媒体文件', extensions: MEDIA_EXTENSIONS }],
    });
    return normalizeDialogPaths(selected);
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

  async inspectPaths(
    paths: string[],
    origin: InputOrigin,
    options?: InputInspectionOptions,
  ): Promise<InputSource[]> {
    if (paths.length === 0) return [];
    const toSource = (item: InspectedInput, id: string): InputSource => ({
      ...item,
      mediaCount: item.mediaCount ?? undefined,
      durationSeconds: item.durationSeconds ?? undefined,
      unknownDurationCount: item.unknownDurationCount ?? undefined,
      detail: item.detail ?? undefined,
      errorCode: item.errorCode ?? undefined,
      id,
    });
    const progress =
      options && new Channel<Omit<InputInspectionProgress, 'item'> & { item: InspectedInput }>();
    if (progress && options) {
      progress.onmessage = (update) =>
        options.onProgress({
          ...update,
          item: toSource(update.item, `${options.importId}-${update.index}`),
        });
    }
    const inspected = await invoke<InspectedInput[]>('inspect_inputs', {
      paths,
      origin,
      ...(options ? { importId: options.importId, onProgress: progress } : {}),
    });
    return inspected.map((item, index) =>
      toSource(
        item,
        options ? `${options.importId}-${index}` : `native-source-${this.inputSequence++}`,
      ),
    );
  }

  async cancelInputInspection(importId: string): Promise<void> {
    const accepted = await invoke<boolean>('cancel_input_inspection', { importId });
    if (accepted === false) {
      // A clear can reach the Host before the inspection has registered.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await invoke('cancel_input_inspection', { importId });
    }
  }

  async runtimeDiagnostics(): Promise<Record<string, unknown>> {
    const [host, health] = await Promise.all([
      invoke<Record<string, unknown>>('get_host_build').catch(() => null),
      invoke<WorkerEnvelope>('worker_health').catch(() => null),
    ]);
    const result = health?.data.result;
    const worker = isRecord(result) ? result : {};
    return {
      appVersion: host?.version ?? '未知',
      frontend: __FRONTEND_BUILD__,
      host,
      worker: worker.worker_build ?? '未知',
      ipcVersion: host?.ipcVersion ?? '未知',
      capabilities: {
        mediaInspection: worker.media_inspection_version ?? '未知',
        startCancellation: worker.start_cancellation_version ?? '未知',
      },
      model: worker.model_id ?? this.lastModelStatus.modelId ?? '未知',
      hardware:
        worker.hardware ?? (this.lastModelStatus.state === 'ready' ? this.lastModelStatus : '未知'),
    };
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

  async openModelDirectory(modelId: ModelId): Promise<void> {
    await invoke('open_model_directory', { modelId });
  }

  async getHardwareCapabilities(modelId?: ModelId) {
    await this.ensureNativeListeners();
    const envelope = modelId
      ? await invoke<WorkerEnvelope>('worker_environment', { modelId })
      : await invoke<WorkerEnvelope>('worker_environment');
    return readHardwareCapabilities(envelope.data.result);
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

  async notifyTaskFinished(notice: TaskFinishedNotice): Promise<boolean> {
    const attentionType =
      notice.status === 'failed' ? UserAttentionType.Critical : UserAttentionType.Informational;
    return this.showAppNotification(
      notice.status,
      `总耗时 ${notice.elapsed}`,
      notice.detail,
      attentionType,
    );
  }

  async notifyPowerCountdown(elapsed: string): Promise<boolean> {
    return this.showAppNotification(
      'power',
      `总耗时 ${elapsed} · 60 秒后关机`,
      '点击通知返回 WhisperSubtitle，可取消本次关机。',
      UserAttentionType.Critical,
    );
  }

  private async showAppNotification(
    status: TaskFinishedNotice['status'] | 'power',
    title: string,
    detail: string,
    attentionType: UserAttentionType,
  ): Promise<boolean> {
    try {
      await getCurrentWindow().requestUserAttention(attentionType);
    } catch {
      // A denied attention permission must not disturb task finalization.
    }
    try {
      await invoke('show_app_notification', { status, title, detail });
      return true;
    } catch {
      return false;
    }
  }

  async startTranscription(
    draft: TranscriptionDraft,
    options: StartTranscriptionOptions = {},
  ): Promise<{ taskId: string }> {
    const requestId = createRequestId();
    const began = options.clickedAt ?? performance.now();
    await this.ensureNativeListeners();
    options.onPreparation?.(requestId, 'checking', false);
    this.preparing.set(requestId, { ...options, clickedAt: began });
    this.pendingTasks.set(requestId, createTaskMetadata(draft));
    try {
      const sent = performance.now();
      this.emit({
        type: 'worker.log',
        line: `[START] ${requestId} · web click to request · ${Math.round(sent - began)} ms`,
      });
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
          execution: draft.execution,
          output: toHostOutput(
            draft.output,
            draft.subtitleParameters,
            options.allowOverwrite === true,
            options.skipConflicts === true,
          ),
        },
      });
      this.emit({
        type: 'worker.log',
        line: `[START] ${requestId} · ${result.taskId} · web request round trip · ${Math.round(performance.now() - sent)} ms`,
      });
      return { taskId: result.taskId };
    } catch (error) {
      this.pendingTasks.delete(requestId);
      this.preparing.delete(requestId);
      const normalized = normalizeInvokeError(error);
      if (isRecord(normalized.data) && normalized.data.exception === 'StartCancelled') {
        throw Object.assign(new Error('启动准备已取消。'), { code: 'start.cancelled' });
      }
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

  async cancelStart(startRequestId: string): Promise<boolean> {
    return invoke<boolean>('cancel_start', { startRequestId });
  }

  async cancelTask(taskId: string): Promise<void> {
    await this.ensureNativeListeners();
    await invoke('cancel_transcription', { taskId });
  }

  subscribe(listener: (event: DesktopEvent) => void): Unlisten {
    this.listeners.add(listener);
    if (!this.disposed) {
      this.dragSetup ??= getCurrentWebviewWindow()
        .onDragDropEvent(({ payload }) => {
          if (payload.type === 'enter') {
            this.emit({ type: 'inputs.drag_active', active: payload.paths.length > 0 });
          } else if (payload.type === 'leave') {
            this.emit({ type: 'inputs.drag_active', active: false });
          } else if (payload.type === 'drop') {
            this.emit({ type: 'inputs.dropped', paths: payload.paths });
          }
        })
        .catch((error: unknown) => {
          this.dragSetup = undefined;
          const normalized = normalizeInvokeError(error);
          this.emit({ type: 'worker.error', code: normalized.code, message: normalized.message });
          return undefined;
        });
    }
    void this.ensureNativeListeners().catch((error: unknown) => {
      const normalized = normalizeInvokeError(error);
      this.emit({ type: 'worker.error', code: normalized.code, message: normalized.message });
    });
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.hostRevision += 1;
    this.lastReadyPid = null;
    void this.dragSetup?.then((unlisten) => unlisten?.());
    this.dragSetup = undefined;
    for (const unlisten of this.nativeUnlisteners.splice(0)) unlisten();
    this.listeners.clear();
    this.pendingTasks.clear();
    this.preparing.clear();
    this.taskClickTimes.clear();
    this.taskStartedAt.clear();
    this.taskProgress.clear();
    if (this.performanceTimer !== undefined) clearInterval(this.performanceTimer);
    if (this.modelHealthTimer !== undefined) clearInterval(this.modelHealthTimer);
    this.performanceTimer = undefined;
    this.modelHealthTimer = undefined;
    this.nativeSetup = undefined;
  }

  private ensureNativeListeners(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Desktop bridge has been disposed'));
    this.nativeSetup ??= this.setupNativeListeners().catch((error: unknown) => {
      for (const unlisten of this.nativeUnlisteners.splice(0)) unlisten();
      this.nativeSetup = undefined;
      throw error;
    });
    return this.nativeSetup;
  }

  private async registerNativeListener(registration: Promise<UnlistenFn>): Promise<void> {
    const unlisten = await registration;
    if (this.disposed) {
      unlisten();
      throw new Error('Desktop bridge has been disposed');
    }
    this.nativeUnlisteners.push(unlisten);
  }

  private async setupNativeListeners(): Promise<void> {
    await this.registerNativeListener(
      listen<HostStatus>('desktop://host-status', ({ payload }) => this.handleHostStatus(payload)),
    );
    await this.registerNativeListener(
      listen<WorkerEnvelope>('desktop://worker-message', ({ payload }) =>
        this.handleWorkerMessage(payload),
      ),
    );
    await this.registerNativeListener(
      listen<{ line: string }>('desktop://worker-log', ({ payload }) =>
        this.emit({ type: 'worker.log', line: payload.line }),
      ),
    );
    await this.registerNativeListener(
      listen('desktop://worker-logs-cleared', () => this.emit({ type: 'worker.logs_cleared' })),
    );
    await this.registerNativeListener(
      listen<PowerActionStatus>('desktop://power-action', ({ payload }) =>
        this.emit({ type: 'power.action', status: payload }),
      ),
    );
    const revision = this.hostRevision;
    const status = await invoke<HostStatus>('get_host_status');
    if (this.disposed) return;
    if (revision === this.hostRevision) this.handleHostStatus(status);
    const existingLogs = await invoke<string[]>('get_worker_logs');
    if (this.disposed) return;
    if (Array.isArray(existingLogs)) {
      existingLogs.forEach((line) => this.emit({ type: 'worker.log', line }));
    }
    await this.refreshPerformance();
    await this.refreshModelHealth();
    if (this.disposed) return;
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
    if (this.disposed) return;
    this.hostRevision += 1;
    this.emit({ type: 'host.status', status });
    if (status.state === 'ready' && status.pid !== this.lastReadyPid) {
      this.lastReadyPid = status.pid;
      void this.refreshModelHealth();
      void this.refreshEnvironment();
    }
    if (status.state !== 'ready') {
      this.lastReadyPid = null;
      this.canCancelStart = false;
      if (status.state === 'failed' || status.state === 'stopped') {
        this.pendingTasks.clear();
        this.preparing.clear();
        this.taskClickTimes.clear();
        this.taskStartedAt.clear();
        this.taskProgress.clear();
      }
    }
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
    const revision = this.hostRevision;
    try {
      const envelope = await invoke<WorkerEnvelope>('worker_environment');
      if (this.disposed || revision !== this.hostRevision) return;
      const result = envelope.data.result;
      if (isWorkerEnvironment(result)) {
        this.emit({
          type: 'worker.environment',
          environment: result,
        });
      }
    } catch (error) {
      if (this.disposed || revision !== this.hostRevision) return;
      const normalized = normalizeInvokeError(error);
      this.emit({ type: 'worker.error', code: normalized.code, message: normalized.message });
    }
  }

  private async refreshPerformance(): Promise<void> {
    if (this.lastReadyPid === null || this.performancePolling) return;
    this.performancePolling = true;
    const revision = this.hostRevision;
    try {
      const envelope = await invoke<WorkerEnvelope>('worker_metrics');
      if (this.disposed || revision !== this.hostRevision) return;
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
    if (this.lastReadyPid === null || this.modelHealthPolling) return;
    this.modelHealthPolling = true;
    const revision = this.hostRevision;
    const previousModel = this.lastModelStatus;
    try {
      const envelope = await invoke<WorkerEnvelope>('worker_health');
      if (this.disposed || revision !== this.hostRevision) return;
      const result = envelope.data.result;
      if (!isRecord(result)) return;
      this.canCancelStart = result.start_cancellation_version === 1;
      if (previousModel !== this.lastModelStatus) return;
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
    } finally {
      this.modelHealthPolling = false;
    }
  }

  private handleWorkerMessage(message: WorkerEnvelope): void {
    const pending = message.request_id ? this.preparing.get(message.request_id) : undefined;
    if (pending && message.request_id) {
      if (message.event === 'model.loading') {
        pending.onPreparation?.(message.request_id, 'loading', this.canCancelStart);
      }
      if (message.event === 'task.queued' && message.task_id && pending.clickedAt !== undefined) {
        this.taskClickTimes.set(message.task_id, pending.clickedAt);
        this.preparing.delete(message.request_id);
      }
    }
    if (message.type === 'error' && message.data.exception === 'StartCancelled') return;
    if (
      message.task_id &&
      ['task.completed', 'task.failed', 'task.cancelled'].includes(message.event ?? '')
    ) {
      const began = this.taskClickTimes.get(message.task_id);
      if (began !== undefined) {
        this.emit({
          type: 'worker.log',
          line: `[TASK ${message.task_id}] web click to terminal · ${Math.round(performance.now() - began)} ms · ${message.event}`,
        });
        this.taskClickTimes.delete(message.task_id);
      }
    }
    dispatchWorkerMessage(message, {
      pendingTasks: this.pendingTasks,
      taskStartedAt: this.taskStartedAt,
      taskProgress: this.taskProgress,
      emit: (event) => this.emit(event),
      emitModelStatus: (model) => this.emitModelStatus(model),
    });
  }

  private emit(event: DesktopEvent): void {
    if (this.disposed) return;
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

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { open } from '@tauri-apps/plugin-dialog';

import type {
  DesktopBridge,
  DesktopEvent,
  EditableParameters,
  HostStatus,
  InputOrigin,
  InputSource,
  ModelStatus,
  OutputPolicy,
  OutputPreview,
  TaskSnapshot,
  TranscriptionDraft,
  Unlisten,
  WorkerEnvironment,
} from '../contracts/desktop';

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

interface InspectedInput {
  path: string;
  kind: 'file' | 'directory';
  origin: InputOrigin;
  valid: boolean;
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
  private performancePolling = false;
  private inputSequence = 1;
  private lastReadyPid: number | null = null;

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
      detail: item.detail ?? undefined,
      id: `native-source-${this.inputSequence++}`,
    }));
  }

  async revealOutput(path: string): Promise<void> {
    await invoke('reveal_output', { path });
  }

  async readOutputPreview(path: string): Promise<OutputPreview> {
    return invoke<OutputPreview>('read_output_preview', { path });
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

  async startTranscription(draft: TranscriptionDraft): Promise<{ taskId: string }> {
    await this.ensureNativeListeners();
    const requestId = createRequestId();
    this.pendingTasks.set(requestId, createTaskMetadata(draft));
    try {
      const result = await invoke<HostStartResult>('start_transcription', {
        draft: {
          requestId,
          inputs: draft.inputs.map(({ path, kind, origin }) => ({ path, kind, origin })),
          basePresetId: draft.basePresetId,
          overrides: draft.overrides,
          output: toHostOutput(draft.output),
        },
      });
      return { taskId: result.taskId };
    } catch (error) {
      this.pendingTasks.delete(requestId);
      throw normalizeInvokeError(error);
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
    this.performanceTimer = undefined;
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
    await this.refreshPerformance();
    this.performanceTimer = setInterval(() => void this.refreshPerformance(), 2000);
  }

  private handleHostStatus(status: HostStatus): void {
    this.emit({ type: 'host.status', status });
    if (status.state === 'ready' && status.pid !== this.lastReadyPid) {
      this.lastReadyPid = status.pid;
      void this.refreshEnvironment();
    }
    if (status.state !== 'ready') this.lastReadyPid = null;
  }

  private async refreshEnvironment(): Promise<void> {
    try {
      const envelope = await invoke<WorkerEnvelope>('worker_environment');
      const result = envelope.data.result;
      if (isWorkerEnvironment(result)) {
        this.emit({ type: 'worker.environment', environment: result });
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
            gpuName: result.gpu_name,
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

  private handleWorkerMessage(message: WorkerEnvelope): void {
    if (message.type === 'error') {
      const code = message.code ?? 'worker.error';
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
        this.emit({
          type: 'model.status',
          model: {
            state: 'loading',
            modelId: readString(message.data.model_id),
            device: null,
            computeType: null,
          },
        });
        break;
      case 'model.ready':
        this.emit({
          type: 'model.status',
          model: {
            state: 'ready',
            modelId: readString(message.data.model_id),
            device: readString(message.data.device),
            computeType: readString(message.data.compute_type),
          },
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
      isCustom: metadata?.isCustom ?? false,
      status: 'queued',
      progress: 0,
      stage: '已进入本地队列',
      elapsed: '00:00',
      createdAt: metadata?.createdAt ?? currentClock(),
      draft: metadata?.draft,
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
}

function normalizeDialogPaths(value: string | string[] | null): string[] {
  if (value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function createRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? `${Date.now()}`;
  return `desktop-${random}`;
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
    createdAt: currentClock(),
    draft: structuredClone(draft),
  };
}

function toHostOutput(output: OutputPolicy) {
  return {
    mode: output.mode,
    rootDirectory: output.mode === 'custom' ? output.rootDirectory : null,
    txtEnabled: output.txtEnabled,
    markdownEnabled: output.markdownEnabled,
    preserveSourceTxt: output.preserveSourceTxt,
    conflictPolicy: output.conflictPolicy,
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

function currentClock(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isWorkerEnvironment(value: unknown): value is WorkerEnvironment {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.available === 'boolean' &&
    Array.isArray(candidate.errors) &&
    candidate.errors.every((item) => typeof item === 'string') &&
    typeof candidate.python === 'string' &&
    typeof candidate.platform === 'string'
  );
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
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isPerformanceResult(value: unknown): value is PerformanceResult {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.timestamp_ms === 'number' &&
    typeof item.cpu_percent === 'number' &&
    typeof item.memory_percent === 'number' &&
    typeof item.memory_used_gib === 'number' &&
    typeof item.memory_total_gib === 'number' &&
    isNullableNumber(item.gpu_percent) &&
    isNullableNumber(item.vram_used_gib) &&
    isNullableNumber(item.vram_total_gib) &&
    (item.gpu_name === null || typeof item.gpu_name === 'string')
  );
}

function normalizeInvokeError(error: unknown): Error & { code: string } {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>;
    const code = typeof candidate.code === 'string' ? candidate.code : 'host.command_failed';
    const message =
      typeof candidate.message === 'string'
        ? candidate.message
        : (ERROR_LABELS[code] ?? '桌面命令执行失败');
    return Object.assign(new Error(message), { code });
  }
  return Object.assign(new Error(String(error)), { code: 'host.command_failed' });
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export type { EditableParameters, ModelStatus };

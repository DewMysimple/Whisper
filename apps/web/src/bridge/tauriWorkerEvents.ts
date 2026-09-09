import type { DesktopEvent, ModelStatus, TaskSnapshot } from '../contracts/desktop';
import { DEFAULT_MODEL_ID } from '../contracts/desktop';
import { TaskProgressTracker } from './taskProgress';
import {
  ERROR_LABELS,
  STAGE_LABELS,
  currentTimestamp,
  isModelId,
  isRecognitionStrategy,
  outputConflictDetails,
  readConflictGroups,
  readNullableNumberArray,
  readNumber,
  readRecognitionQualityDiagnostics,
  readResolvedHardware,
  readString,
  readStringArray,
  readTaskMediaStatus,
  type PendingTaskMetadata,
} from './tauriWorkerDecoder';

export interface WorkerEnvelope {
  schema_version: 1;
  type: 'event' | 'error';
  request_id?: string;
  task_id?: string;
  event?: string;
  code?: string;
  data: Record<string, unknown>;
}

export interface WorkerEventContext {
  pendingTasks: Map<string, PendingTaskMetadata>;
  taskStartedAt: Map<string, number>;
  taskProgress: TaskProgressTracker;
  emit(event: DesktopEvent): void;
  emitModelStatus(model: ModelStatus): void;
}

export function handleWorkerMessage(message: WorkerEnvelope, context: WorkerEventContext): void {
  if (message.type === 'error') {
    const code = message.code ?? 'worker.error';
    if (
      code === 'output.failed' &&
      message.request_id !== undefined &&
      context.pendingTasks.has(message.request_id) &&
      outputConflictDetails(message.data) !== null
    ) {
      return;
    }
    context.emit({
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
      context.emitModelStatus({
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
      context.emitModelStatus({
        state: 'ready',
        modelId: message.data.model_id,
        device: readString(message.data.device),
        computeType: readString(message.data.compute_type),
        deviceIndex: readNumber(message.data.device_index),
        cpuThreads: readNumber(message.data.cpu_threads),
      });
      break;
    case 'task.queued':
      handleTaskQueued(message, context);
      break;
    case 'task.progress':
      handleTaskProgress(message, context);
      break;
    case 'task.completed':
      handleTaskCompleted(message, context);
      break;
    case 'task.failed':
      handleTaskFailed(message, context);
      break;
    case 'task.cancelled':
      if (message.task_id) {
        context.emit({ type: 'task.cancelled', taskId: message.task_id });
        context.taskStartedAt.delete(message.task_id);
        context.taskProgress.finish(message.task_id);
      }
      break;
  }
}

function handleTaskQueued(message: WorkerEnvelope, context: WorkerEventContext): void {
  if (!message.task_id) return;
  const metadata = message.request_id ? context.pendingTasks.get(message.request_id) : undefined;
  const mediaPaths = readStringArray(message.data.media_paths);
  const mediaDurations = readNullableNumberArray(message.data.media_durations_seconds);
  const skippedMedia = readConflictGroups(message.data.skipped_media);
  const task: TaskSnapshot = {
    id: message.task_id,
    title: metadata?.title ?? `本地任务 ${message.task_id.slice(-8)}`,
    sourceCount: readNumber(message.data.input_count) ?? metadata?.sourceCount ?? 1,
    presetId: metadata?.presetId ?? 'en_v1',
    modelId: isModelId(message.data.model_id)
      ? message.data.model_id
      : (metadata?.draft.modelId ?? DEFAULT_MODEL_ID),
    recognitionStrategy: isRecognitionStrategy(message.data.recognition_strategy)
      ? message.data.recognition_strategy
      : (metadata?.draft.recognitionStrategy ?? 'stable_primary'),
    isCustom: metadata?.isCustom ?? false,
    status: 'queued',
    progress: 0,
    stage: '已进入本地队列',
    elapsed: '00:00',
    createdAt: metadata?.createdAt ?? currentTimestamp(),
    draft: metadata?.draft,
    hardware: readResolvedHardware(message.data.hardware),
    mediaPaths,
    skippedMedia,
    processingCount:
      mediaPaths.length > 0 ? mediaPaths.length : (readNumber(message.data.input_count) ?? 1),
    ...(mediaDurations.length === mediaPaths.length && mediaPaths.length > 0
      ? {
          totalMediaDurationSeconds: mediaDurations
            .filter((value): value is number => value !== null)
            .reduce((total, value) => total + value, 0),
          unknownMediaDurationCount: mediaDurations.filter((value) => value === null).length,
        }
      : {}),
    mediaStates: [
      ...mediaPaths.map((path, index) => ({
        path,
        status: 'pending' as const,
        progress: 0,
        stage: '等待处理',
        elapsedSeconds: 0,
        ...(mediaDurations.length === mediaPaths.length
          ? { durationSeconds: mediaDurations[index] }
          : {}),
      })),
      ...skippedMedia.map((item) => ({
        path: item.inputPath,
        status: 'skipped' as const,
        progress: null,
        stage: '已跳过同名输出',
        elapsedSeconds: 0,
        outputPaths: item.paths,
      })),
    ],
  };
  if (message.request_id) context.pendingTasks.delete(message.request_id);
  context.taskStartedAt.set(message.task_id, Date.now());
  context.taskProgress.start(message.task_id, task.processingCount);
  context.emit({ type: 'task.queued', task });
}

function handleTaskProgress(message: WorkerEnvelope, context: WorkerEventContext): void {
  if (!message.task_id) return;
  const stage = readString(message.data.stage) ?? 'transcription.running';
  const current = readNumber(message.data.current) ?? 0;
  const total = readNumber(message.data.total) ?? 0;
  const mediaProgress = readNumber(message.data.media_progress_percent) ?? undefined;
  const mediaStatus = readTaskMediaStatus(message.data.media_status);
  context.emit({
    type: 'task.progress',
    taskId: message.task_id,
    progress: context.taskProgress.update(message.task_id, {
      stage,
      current,
      total,
      mediaProgress,
      mediaStatus,
    }),
    stage: STAGE_LABELS[stage] ?? stage,
    elapsed: elapsedFor(message.task_id, context),
    inputPath: readString(message.data.input_path) ?? undefined,
    mediaIndex: readNumber(message.data.media_index) ?? undefined,
    mediaTotal: total > 0 ? total : undefined,
    mediaProgress,
    mediaElapsedSeconds: readNumber(message.data.media_elapsed_seconds) ?? undefined,
    taskElapsedSeconds: readNumber(message.data.task_elapsed_seconds) ?? undefined,
    mediaStatus,
    outputPaths: readStringArray(message.data.output_paths),
    qualityDiagnostics: readRecognitionQualityDiagnostics(message.data.quality_diagnostics),
  });
}

function handleTaskCompleted(message: WorkerEnvelope, context: WorkerEventContext): void {
  if (!message.task_id) return;
  const outputs = Array.isArray(message.data.outputs)
    ? message.data.outputs.filter((item): item is string => typeof item === 'string')
    : [];
  const skippedMedia = readConflictGroups(message.data.skipped_media);
  context.emit({
    type: 'task.completed',
    taskId: message.task_id,
    elapsed: elapsedFor(message.task_id, context),
    outputs,
    skippedMedia,
    successCount: readNumber(message.data.success_count) ?? undefined,
    failureCount: readNumber(message.data.failure_count) ?? undefined,
  });
  context.taskStartedAt.delete(message.task_id);
  context.taskProgress.finish(message.task_id);
}

function handleTaskFailed(message: WorkerEnvelope, context: WorkerEventContext): void {
  if (!message.task_id) return;
  const code = readString(message.data.error_code) ?? 'transcription.failed';
  context.emit({
    type: 'task.failed',
    taskId: message.task_id,
    code,
    message: ERROR_LABELS[code] ?? '本地转录任务失败',
  });
  context.taskStartedAt.delete(message.task_id);
  context.taskProgress.finish(message.task_id);
}

function elapsedFor(taskId: string, context: WorkerEventContext): string {
  const startedAt = context.taskStartedAt.get(taskId) ?? Date.now();
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

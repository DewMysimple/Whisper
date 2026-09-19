import type { DesktopEvent } from '../contracts/desktop';
import { notifyPowerCountdown, notifyTaskFinished } from '../notifications';
import { appendPerformanceSample } from './performanceWindow';
import { elapsedTextSeconds } from './taskTiming';
import { mergeUniqueInputs } from './workspaceDraft';
import type { WorkspaceState } from './workspace';
import {
  isTerminalTaskStatus,
  limitTaskQualityDiagnostics,
  updateTaskMediaStates,
} from './workspaceTaskState';

type WorkspaceSet = (
  partial: Partial<WorkspaceState> | ((state: WorkspaceState) => Partial<WorkspaceState>),
) => void;
type WorkspaceGet = () => WorkspaceState;
type PersistLater = (get: WorkspaceGet) => void;

export function handleWorkspaceEvent(
  event: DesktopEvent,
  set: WorkspaceSet,
  get: WorkspaceGet,
  persistLater: PersistLater,
): void {
  if (event.type === 'inputs.added') {
    set((state) => ({ inputs: mergeUniqueInputs(state.inputs, event.inputs) }));
    return;
  }
  if (event.type === 'host.status') {
    set({ hostStatus: event.status, lastError: event.status.error });
    if (event.status.state === 'failed' || event.status.state === 'stopped') {
      // The Host clears its active tasks on disconnect; no terminal Worker events follow.
      for (const task of get().tasks) {
        if (isTerminalTaskStatus(task.status)) continue;
        handleWorkspaceEvent(
          {
            type: 'task.failed',
            taskId: task.id,
            code: 'host.worker_disconnected',
            message: '本地推理 Worker 已断开，任务已中断',
          },
          set,
          get,
          persistLater,
        );
      }
    }
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
    set((state) => ({ logs: [...state.logs, event.line] }));
    return;
  }
  if (event.type === 'worker.logs_cleared') {
    set({ logs: [] });
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
  if (event.type === 'power.action') {
    set({
      powerActionStatus: event.status,
      shutdownArmed: event.status.state === 'armed' || event.status.state === 'countdown',
    });
    return;
  }
  if (event.type === 'task.queued') {
    if (get().tasks.some((task) => task.id === event.task.id)) return;
    set((state) => ({
      tasks: [event.task, ...state.tasks],
      monitoredTaskId: state.monitoredTaskId ?? event.task.id,
    }));
    persistLater(get);
    return;
  }
  if (event.type === 'task.progress') {
    const target = get().tasks.find((task) => task.id === event.taskId);
    if (target === undefined || isTerminalTaskStatus(target.status)) return;
    set((state) => ({
      monitoredTaskId: event.taskId,
      taskWorkspaceMode: state.activeView === 'tasks' ? state.taskWorkspaceMode : 'monitor',
      tasks: state.tasks.map((task) => {
        if (task.id !== event.taskId || isTerminalTaskStatus(task.status)) return task;
        const newOutputs = event.outputPaths ?? [];
        return {
          ...task,
          status: 'running',
          progress: Math.max(task.progress, event.progress),
          stage: event.stage,
          stageCode: event.stageCode,
          elapsed: event.elapsed,
          activeInput: event.inputPath ?? task.activeInput,
          currentMediaIndex: event.mediaIndex ?? task.currentMediaIndex,
          processingCount: event.mediaTotal ?? task.processingCount,
          taskElapsedSeconds: event.taskElapsedSeconds ?? elapsedTextSeconds(event.elapsed),
          mediaStates: limitTaskQualityDiagnostics(updateTaskMediaStates(task, event)),
          outputs:
            newOutputs.length > 0
              ? [...new Set([...(task.outputs ?? []), ...newOutputs])]
              : task.outputs,
          outputAvailability: newOutputs.length > 0 ? 'available' : task.outputAvailability,
        };
      }),
    }));
    persistLater(get);
    return;
  }
  const stateBeforeTerminal = get();
  const finishedTask = stateBeforeTerminal.tasks.find((task) => task.id === event.taskId);
  if (finishedTask === undefined || isTerminalTaskStatus(finishedTask.status)) return;
  const partiallyFailed = event.type === 'task.completed' && (event.failureCount ?? 0) > 0;
  const startsShutdownCountdown =
    event.type === 'task.completed' &&
    !partiallyFailed &&
    stateBeforeTerminal.shutdownArmed &&
    !stateBeforeTerminal.tasks.some(
      (task) => task.id !== event.taskId && (task.status === 'queued' || task.status === 'running'),
    );
  set((state) => ({
    tasks: state.tasks.map((task) => {
      if (task.id !== event.taskId) return task;
      if (event.type === 'task.completed') {
        const partiallyFailed = (event.failureCount ?? 0) > 0;
        return {
          ...task,
          status: partiallyFailed ? 'failed' : 'completed',
          progress: 100,
          stage: partiallyFailed ? '部分媒体处理失败' : '输出已生成',
          elapsed: event.elapsed,
          taskElapsedSeconds: elapsedTextSeconds(event.elapsed),
          outputs: event.outputs,
          skippedMedia: event.skippedMedia ?? task.skippedMedia,
          outputAvailability: event.outputs.length > 0 ? 'available' : 'missing',
          completedAt: new Date().toISOString(),
          mediaStates: task.mediaStates?.map((media) =>
            media.status === 'skipped' || media.status === 'failed'
              ? media
              : partiallyFailed && media.status !== 'completed'
                ? { ...media, status: 'failed', stage: '处理未确认完成' }
                : { ...media, status: 'completed', progress: 100, stage: '已完成' },
          ),
          errorCode: partiallyFailed ? 'transcription.partial_failure' : task.errorCode,
        };
      }
      if (event.type === 'task.failed') {
        return {
          ...task,
          status: 'failed',
          stage: event.message,
          elapsed: event.elapsed ?? task.elapsed,
          taskElapsedSeconds:
            event.elapsed === undefined
              ? task.taskElapsedSeconds
              : elapsedTextSeconds(event.elapsed),
          errorCode: event.code,
          completedAt: new Date().toISOString(),
        };
      }
      return {
        ...task,
        status: 'cancelled',
        stage: '已取消',
        elapsed: event.elapsed ?? task.elapsed,
        taskElapsedSeconds:
          event.elapsed === undefined ? task.taskElapsedSeconds : elapsedTextSeconds(event.elapsed),
        completedAt: new Date().toISOString(),
      };
    }),
  }));
  if (finishedTask !== undefined) {
    if (startsShutdownCountdown) {
      void notifyPowerCountdown(event.elapsed);
    } else if (
      event.type !== 'task.completed' ||
      partiallyFailed ||
      !stateBeforeTerminal.shutdownArmed
    ) {
      void notifyTaskFinished({
        status:
          event.type === 'task.completed' && !partiallyFailed
            ? 'completed'
            : event.type === 'task.failed' || partiallyFailed
              ? 'failed'
              : 'cancelled',
        elapsed: event.elapsed ?? finishedTask.elapsed,
        detail:
          event.type === 'task.completed' && !partiallyFailed
            ? `已生成 ${event.outputs.length} 个输出文件`
            : partiallyFailed
              ? `${event.failureCount} 个媒体处理失败，已生成 ${event.outputs.length} 个输出文件`
              : event.type === 'task.failed'
                ? event.message
                : '任务已取消',
      });
    }
  }
  persistLater(get);
}

import type {
  DesktopEvent,
  HardwarePreference,
  ModelStatus,
  WorkerEnvironment,
} from '../contracts/desktop';
import { notifyPowerCountdown, notifyTaskFinished } from '../notifications';
import { appendPerformanceSample } from './performanceWindow';
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

function mergeUniqueInputs(
  existing: WorkspaceState['inputs'],
  incoming: WorkspaceState['inputs'],
): WorkspaceState['inputs'] {
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

function modelMatchesPreference(
  model: ModelStatus,
  preference: HardwarePreference,
  capabilities: WorkerEnvironment['hardware'],
): boolean {
  if (model.state !== 'ready') return false;
  const expectedDevice =
    preference.mode === 'auto'
      ? (capabilities?.gpus.length ?? 0) > 0
        ? 'cuda'
        : 'cpu'
      : preference.mode;
  if (model.device !== expectedDevice) return false;
  if (expectedDevice === 'cuda') {
    return (
      model.deviceIndex === preference.gpuDeviceIndex &&
      model.computeType === preference.cudaComputeType
    );
  }
  return (
    model.computeType === preference.cpuComputeType && model.cpuThreads === preference.cpuThreads
  );
}

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
    return;
  }
  if (event.type === 'worker.environment') {
    set({ environment: event.environment });
    return;
  }
  if (event.type === 'model.status') {
    set({
      model: event.model,
      pendingModelId:
        event.model.state === 'ready' && event.model.modelId === get().selectedModelId
          ? null
          : get().pendingModelId,
      pendingHardware:
        event.model.state === 'ready' &&
        modelMatchesPreference(event.model, get().hardwarePreference, get().environment?.hardware)
          ? false
          : get().pendingHardware,
    });
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
    set((state) => ({
      tasks: [event.task, ...state.tasks],
      monitoredTaskId: state.monitoredTaskId ?? event.task.id,
    }));
    persistLater(get);
    return;
  }
  if (event.type === 'task.progress') {
    set((state) => ({
      monitoredTaskId: event.taskId,
      taskWorkspaceMode: state.activeView === 'tasks' ? state.taskWorkspaceMode : 'monitor',
      tasks: state.tasks.map((task) => {
        if (task.id !== event.taskId || isTerminalTaskStatus(task.status)) return task;
        const newOutputs = event.outputPaths ?? [];
        return {
          ...task,
          status: 'running',
          progress: event.progress,
          stage: event.stage,
          elapsed: event.elapsed,
          activeInput: event.inputPath ?? task.activeInput,
          currentMediaIndex: event.mediaIndex ?? task.currentMediaIndex,
          processingCount: event.mediaTotal ?? task.processingCount,
          taskElapsedSeconds: event.taskElapsedSeconds ?? task.taskElapsedSeconds,
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
          outputs: event.outputs,
          skippedMedia: event.skippedMedia ?? task.skippedMedia,
          outputAvailability: event.outputs.length > 0 ? 'available' : 'missing',
          completedAt: new Date().toISOString(),
          mediaStates: task.mediaStates?.map((media) =>
            media.status === 'skipped' || media.status === 'failed'
              ? media
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
        elapsed: event.type === 'task.completed' ? event.elapsed : finishedTask.elapsed,
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
  if (
    get().pendingModelId !== null &&
    !get().tasks.some((task) => task.status === 'queued' || task.status === 'running')
  ) {
    const pending = get().pendingModelId;
    if (pending !== null) void get().selectModel(pending);
    return;
  }
  if (
    get().pendingHardware &&
    !get().tasks.some((task) => task.status === 'queued' || task.status === 'running')
  ) {
    void get().setHardwarePreference(get().hardwarePreference);
  }
}

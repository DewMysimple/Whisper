import type { TaskMediaSnapshot, TaskSnapshot } from '../contracts/desktop';
import { activeTaskId } from './workspaceTaskState';
import { formatTaskStage } from './taskStage';

function sameMediaPath(left: string, right: string | undefined): boolean {
  return (
    right !== undefined &&
    left.replaceAll('/', '\\').toLowerCase() === right.replaceAll('/', '\\').toLowerCase()
  );
}

export function resolveTaskMonitorTarget(
  tasks: TaskSnapshot[],
  monitoredTaskId: string | null,
  inputTaskPreview: TaskSnapshot | null,
): TaskSnapshot | undefined {
  return (
    inputTaskPreview ??
    tasks.find((task) => task.id === monitoredTaskId) ??
    tasks.find((task) => task.id === activeTaskId(tasks))
  );
}

export function monitorMediaStates(task: TaskSnapshot | undefined): TaskMediaSnapshot[] {
  if (!task) return [];
  if (task.mediaStates?.length) return task.mediaStates;
  // A directory draft is an input summary, never an expanded media manifest.
  const paths = task.mediaPaths?.length
    ? task.mediaPaths
    : (task.draft?.inputs.filter((input) => input.kind === 'file').map((input) => input.path) ??
      []);
  return paths.map((path) => {
    const completed = task.status === 'completed';
    const running = task.status === 'running' && sameMediaPath(path, task.activeInput);
    return {
      path,
      status: completed ? 'completed' : running ? 'running' : 'pending',
      progress: completed ? 100 : running ? null : 0,
      stage: completed ? '已完成' : running ? task.stage : '等待处理',
      elapsedSeconds: 0,
    };
  });
}

export function currentTaskMedia(
  task: TaskSnapshot | undefined,
  media: TaskMediaSnapshot[],
): TaskMediaSnapshot | undefined {
  if (!task || task.status === 'queued') return undefined;
  return (
    media.find((item) => sameMediaPath(item.path, task.activeInput)) ??
    media.find((item) => item.status === 'running') ??
    (task.currentMediaIndex
      ? media.find((item) =>
          sameMediaPath(item.path, task.mediaPaths?.[task.currentMediaIndex! - 1]),
        )
      : undefined) ??
    (task.status === 'completed'
      ? media.filter((item) => item.status !== 'skipped').at(-1)
      : undefined)
  );
}

export function processedMediaCount(media: TaskMediaSnapshot[]): number {
  return media.filter((item) => item.status === 'completed' || item.status === 'failed').length;
}

export function taskProcessStep(task: TaskSnapshot): number {
  const stage = task.stageCode;
  if (stage === 'input.validating' || stage === 'input.discovering' || stage === 'model.loading')
    return 0;
  if (stage === 'transcription.running') return 1;
  if (stage === 'postprocess.running') return 2;
  if (stage === 'output.writing') return 3;
  if (stage === 'task.finalizing') return 4;
  return -1;
}

const PROCESS_STEPS = ['输入与模型准备', '媒体转录', '文本后处理', '写入输出', '任务汇总'] as const;

export function taskProcessStates(task: TaskSnapshot) {
  const current = taskProcessStep(task);
  const interrupted = task.status === 'failed' || task.status === 'cancelled';
  return PROCESS_STEPS.map((label, index) => {
    const completed = task.status === 'completed' || (current >= 0 && index < current);
    const active = task.status === 'running' && index === current;
    const stopped = interrupted && index === current;
    return {
      label,
      state: completed ? 'complete' : active ? 'active' : stopped ? 'interrupted' : 'pending',
      detail: completed
        ? '完成'
        : active
          ? formatTaskStage(task.stage)
          : stopped
            ? '已中断'
            : interrupted
              ? current < 0
                ? '阶段未记录'
                : '未执行'
              : '待执行',
    };
  });
}

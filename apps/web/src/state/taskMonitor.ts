import type { TaskMediaSnapshot, TaskSnapshot } from '../contracts/desktop';
import { activeTaskId } from './workspaceTaskState';

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
    const running = task.status === 'running' && path === task.activeInput;
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
    media.find((item) => item.path === task.activeInput) ??
    media.find((item) => item.status === 'running') ??
    (task.currentMediaIndex
      ? media.find((item) => item.path === task.mediaPaths?.[task.currentMediaIndex! - 1])
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

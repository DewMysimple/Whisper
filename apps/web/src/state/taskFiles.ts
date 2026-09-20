import type { TaskMediaSnapshot, TaskSnapshot } from '../contracts/desktop';
import { taskOutputPaths } from './workspaceTaskState';

/** Use recorded associations only: batch names can collide and outputs can be renamed. */
export function mediaRevealTarget(task: TaskSnapshot, media: TaskMediaSnapshot): string {
  if (media.status !== 'completed') return media.path;
  const outputs = media.outputPaths?.length
    ? media.outputPaths
    : task.sourceCount === 1
      ? taskOutputPaths(task)
      : [];
  return (
    outputs.find((path) => /\.txt$/i.test(path)) ??
    outputs.find((path) => /\.(md|markdown)$/i.test(path)) ??
    outputs[0] ??
    media.path
  );
}

import { expect, it } from 'vitest';
import type { TaskMediaSnapshot, TaskSnapshot } from '../contracts/desktop';
import { useWorkspace } from './workspace';
import { mediaRevealTarget } from './taskFiles';
import { taskTitleParts } from './taskHistory';

const task: TaskSnapshot = { ...useWorkspace.getInitialState().tasks[0]!, sourceCount: 2 };
const media: TaskMediaSnapshot = {
  path: 'D:\\source\\recording.wav',
  status: 'completed',
  progress: 100,
  stage: '输出已生成',
  elapsedSeconds: 10,
  outputPaths: ['E:\\results\\renamed.srt', 'E:\\results\\renamed.md', 'E:\\results\\renamed.txt'],
};

it('reveals the source until media succeeds, then its recorded renamed text output', () => {
  for (const status of ['pending', 'running', 'failed', 'skipped'] as const) {
    expect(mediaRevealTarget(task, { ...media, status })).toBe(media.path);
  }
  expect(mediaRevealTarget(task, media)).toBe('E:\\results\\renamed.txt');
  expect(mediaRevealTarget(task, { ...media, outputPaths: media.outputPaths!.slice(0, 2) })).toBe(
    'E:\\results\\renamed.md',
  );
  expect(mediaRevealTarget(task, { ...media, outputPaths: ['E:\\results\\renamed.srt'] })).toBe(
    'E:\\results\\renamed.srt',
  );
});

it('never assigns another media output to a legacy batch with no recorded associations', () => {
  const legacy = { ...task, outputs: ['E:\\other\\recording.txt'], mediaStates: [] };
  expect(mediaRevealTarget(legacy, { ...media, outputPaths: undefined })).toBe(media.path);
  expect(
    mediaRevealTarget({ ...legacy, sourceCount: 1 }, { ...media, outputPaths: undefined }),
  ).toBe(legacy.outputs[0]);
  expect(mediaRevealTarget({ ...legacy, outputs: [] }, { ...media, outputPaths: undefined })).toBe(
    media.path,
  );
});

it('removes only presentation whitespace immediately before the extension', () => {
  expect(taskTitleParts('a long recording  .mp4')).toEqual({
    basename: 'a long recording',
    extension: '.mp4',
  });
});

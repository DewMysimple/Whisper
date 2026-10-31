import { expect, it } from 'vitest';
import type { TaskMediaSnapshot, TaskSnapshot } from '../contracts/desktop';
import { useWorkspace } from './workspace';
import { mediaRevealTarget } from './taskFiles';
import { taskTitleParts } from './taskHistory';
import { canResumeTask, taskOutputPaths } from './workspaceTaskState';

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

it('excludes skipped destinations from generated outputs without losing shared real results', () => {
  const generated = 'E:\\results\\clean.txt';
  const reserved = 'E:\\results\\busy.txt';
  const mixed: TaskSnapshot = {
    ...task,
    outputs: [generated],
    mediaStates: [
      { ...media, outputPaths: [generated] },
      { ...media, path: 'D:\\source\\busy.wav', status: 'skipped', outputPaths: [reserved] },
    ],
  };
  // The skipped path can be reserved by another task and not exist on disk yet.
  expect(taskOutputPaths(mixed)).toEqual([generated]);
  expect(taskOutputPaths({ ...mixed, outputs: undefined })).toEqual([generated]);
  expect(taskOutputPaths({ ...mixed, outputs: [], mediaStates: [mixed.mediaStates![1]!] })).toEqual(
    [],
  );
  expect(
    taskOutputPaths({
      ...mixed,
      mediaStates: [
        mixed.mediaStates![0]!,
        { ...mixed.mediaStates![1]!, outputPaths: [generated] },
      ],
    }),
  ).toEqual([generated]);
  // Legacy task-level outputs remain authoritative even without media associations.
  expect(taskOutputPaths({ ...mixed, mediaStates: undefined })).toEqual([generated]);
});

it('keeps skipped output references available for continuation checks', () => {
  const interrupted: TaskSnapshot = {
    ...task,
    status: 'cancelled',
    outputs: [],
    draft: useWorkspace.getInitialState().tasks.find((item) => item.draft)!.draft,
    mediaStates: [
      { ...media, status: 'skipped' },
      { ...media, path: 'D:\\source\\pending.wav', status: 'pending', outputPaths: undefined },
    ],
  };
  expect(canResumeTask(interrupted)).toBe(true);
  expect(taskOutputPaths(interrupted)).toEqual([]);
  expect(interrupted.mediaStates![0]!.outputPaths).toEqual(media.outputPaths);
});

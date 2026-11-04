import { expect, it } from 'vitest';
import { useWorkspace } from './workspace';
import { auditMediaOutputs, canResumeTask } from './workspaceTaskState';
import type { TaskMediaSnapshot, OutputPathStatus } from '../contracts/desktop';

it('requires every original format and valid contents while allowing verified empty files', () => {
  const base = useWorkspace.getInitialState().tasks.find((task) => task.draft)!;
  const task = {
    ...base,
    draft: {
      ...base.draft!,
      output: { ...base.draft!.output, txtEnabled: true, markdownEnabled: true, srtEnabled: true },
    },
  };
  const media: TaskMediaSnapshot = {
    path: 'a.wav',
    status: 'completed',
    progress: 100,
    stage: '',
    elapsedSeconds: 1,
    outputPaths: ['a.txt', 'a.md', 'a.srt'],
  };
  const statuses = new Map<string, OutputPathStatus>(
    media.outputPaths!.map((path) => [path, { path, exists: true, valid: true }]),
  );
  expect(auditMediaOutputs(task, media, statuses)).toBe('available');
  expect(auditMediaOutputs(task, { ...media, outputPaths: ['a.txt'] }, statuses)).toBe('missing');
  statuses.set('a.srt', { path: 'a.srt', exists: true, valid: false, reason: 'invalid time' });
  expect(auditMediaOutputs(task, media, statuses)).toBe('missing');
  statuses.set('a.srt', { path: 'a.srt', exists: false });
  expect(auditMediaOutputs(task, media, statuses)).toBe('missing');
  statuses.delete('a.srt');
  expect(auditMediaOutputs(task, media, statuses)).toBe('unconfirmed');
  expect(auditMediaOutputs({ ...task, draft: undefined }, media, statuses)).toBe('unconfirmed');
  expect(
    canResumeTask({
      ...task,
      status: 'completed',
      outputAvailability: 'missing',
      mediaStates: [media],
    }),
  ).toBe(true);
  expect(
    canResumeTask({
      ...task,
      status: 'failed',
      mediaPaths: ['a.wav', 'unknown.wav'],
      mediaStates: [media],
    }),
  ).toBe(false);
});

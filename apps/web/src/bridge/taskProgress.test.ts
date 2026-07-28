import { describe, expect, it } from 'vitest';

import { TaskProgressTracker } from './taskProgress';

describe('TaskProgressTracker', () => {
  it('keeps a multi-media task monotonic when the next media starts', () => {
    const tracker = new TaskProgressTracker();
    tracker.start('task-1', 2);

    const values = [
      tracker.update('task-1', {
        stage: 'transcription.running',
        current: 1,
        total: 2,
        mediaProgress: 80,
      }),
      tracker.update('task-1', {
        stage: 'output.writing',
        current: 1,
        total: 2,
        mediaProgress: 100,
        mediaStatus: 'completed',
      }),
      tracker.update('task-1', {
        stage: 'transcription.running',
        current: 2,
        total: 2,
        mediaProgress: 0,
        mediaStatus: 'running',
      }),
      tracker.update('task-1', {
        stage: 'transcription.running',
        current: 2,
        total: 2,
        mediaProgress: 35,
        mediaStatus: 'running',
      }),
    ];

    expect(values).toEqual([...values].sort((left, right) => left - right));
    expect(values[2]).toBe(values[1]);
  });

  it('retains the most recent media percentage when sparse events omit it', () => {
    const tracker = new TaskProgressTracker();
    const known = tracker.update('task-2', {
      stage: 'transcription.running',
      current: 1,
      total: 1,
      mediaProgress: 42,
    });
    const sparse = tracker.update('task-2', {
      stage: 'transcription.running',
      current: 1,
      total: 1,
    });

    expect(sparse).toBe(known);
  });

  it('ignores late lower percentages for the same media', () => {
    const tracker = new TaskProgressTracker();
    const latest = tracker.update('task-3', {
      stage: 'transcription.running',
      current: 1,
      total: 1,
      mediaProgress: 70,
    });
    const late = tracker.update('task-3', {
      stage: 'transcription.running',
      current: 1,
      total: 1,
      mediaProgress: 20,
    });

    expect(late).toBe(latest);
  });

  it('finishes the current media share when that media fails', () => {
    const tracker = new TaskProgressTracker();
    const failed = tracker.update('task-4', {
      stage: 'transcription.running',
      current: 1,
      total: 2,
      mediaStatus: 'failed',
    });
    const next = tracker.update('task-4', {
      stage: 'transcription.running',
      current: 2,
      total: 2,
      mediaProgress: 0,
    });

    expect(next).toBe(failed);
  });

  it('reserves 100 percent for the terminal event', () => {
    const tracker = new TaskProgressTracker();
    expect(
      tracker.update('task-5', {
        stage: 'task.finalizing',
        current: 2,
        total: 2,
      }),
    ).toBe(99);
  });
});

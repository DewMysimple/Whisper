import { describe, expect, it } from 'vitest';

import type { InputSource } from '../contracts/desktop';
import {
  formatDurationSummary,
  formatMediaDuration,
  summarizeInputDurations,
} from './mediaDuration';

describe('media duration presentation', () => {
  it('formats short and hour-long media without fabricating missing values', () => {
    expect(formatMediaDuration(65.4)).toBe('01:05');
    expect(formatMediaDuration(3661)).toBe('01:01:01');
    expect(formatMediaDuration(undefined)).toBe('时长未知');
  });

  it('summarizes known duration and unknown media separately', () => {
    const inputs: InputSource[] = [
      {
        id: 'file',
        path: 'C:\\Media\\one.mp4',
        kind: 'file',
        origin: 'dialog',
        valid: true,
        mediaCount: 1,
        durationSeconds: 60,
        unknownDurationCount: 0,
      },
      {
        id: 'folder',
        path: 'C:\\Media\\Batch',
        kind: 'directory',
        origin: 'dialog',
        valid: true,
        mediaCount: 2,
        durationSeconds: 30,
        unknownDurationCount: 1,
      },
    ];

    const summary = summarizeInputDurations(inputs);
    expect(summary).toEqual({ knownSeconds: 90, unknownCount: 1 });
    expect(formatDurationSummary(summary)).toBe('已知 01:30 + 1 个未知');
  });
});

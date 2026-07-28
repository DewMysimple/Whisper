import { describe, expect, it } from 'vitest';

import type { TaskSnapshot } from '../contracts/desktop';
import {
  availableTaskDates,
  formatTaskCreatedAt,
  normalizeTaskDateRange,
  taskDateKey,
  taskMatchesDateRange,
} from './taskHistory';

function task(id: string, createdAt: string): TaskSnapshot {
  return {
    id,
    title: `${id}.mp4`,
    sourceCount: 1,
    presetId: 'cn2',
    modelId: 'large-v3-turbo',
    isCustom: false,
    status: 'completed',
    progress: 100,
    stage: '完成',
    elapsed: '00:10',
    createdAt,
  };
}

describe('task history dates', () => {
  it('formats ISO timestamps in local time and preserves legacy clock records as unknown', () => {
    const timestamp = '2026-07-22T21:30:00+08:00';
    expect(taskDateKey(timestamp)).toBe('2026-07-22');
    expect(formatTaskCreatedAt(timestamp)).toBe('2026-07-22 21:30');
    expect(taskDateKey('21:30')).toBeNull();
    expect(formatTaskCreatedAt('21:30')).toBe('日期未知 · 21:30');
  });

  it('returns only real task dates and composes an inclusive normalized range', () => {
    const tasks = [
      task('old', '21:30'),
      task('later', '2026-07-22T20:00:00+08:00'),
      task('earlier', '2026-07-20T08:00:00+08:00'),
      task('same-day', '2026-07-22T09:00:00+08:00'),
    ];
    expect(availableTaskDates(tasks)).toEqual(['2026-07-20', '2026-07-22']);
    const range = normalizeTaskDateRange('2026-07-22', '2026-07-20');
    expect(range).toEqual({ start: '2026-07-20', end: '2026-07-22' });
    expect(
      tasks.filter((item) => taskMatchesDateRange(item, range)).map((item) => item.id),
    ).toEqual(['later', 'earlier', 'same-day']);
    expect(taskMatchesDateRange(tasks[0]!, null)).toBe(true);
  });
});

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskMediaSnapshot, TaskSnapshot } from '../contracts/desktop';
import { useTaskTiming } from './useTaskTiming';

const MEDIA: TaskMediaSnapshot = {
  path: 'D:\\Media\\one.mp4',
  status: 'running',
  progress: 30,
  stage: '正在转录',
  elapsedSeconds: 3,
};

const TASK: TaskSnapshot = {
  id: 'task-timing',
  title: 'one.mp4',
  sourceCount: 1,
  presetId: 'cn2',
  modelId: 'large-v3-turbo',
  isCustom: false,
  status: 'running',
  progress: 30,
  stage: '正在转录',
  elapsed: '00:10',
  taskElapsedSeconds: 10,
  createdAt: '2026-07-24T10:00:00.000Z',
};

describe('useTaskTiming', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks between progress events and freezes the displayed value at terminal state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T10:00:00.000Z'));
    const { result, rerender } = renderHook(
      ({ task, media }: { task: TaskSnapshot; media: TaskMediaSnapshot }) =>
        useTaskTiming(task, media),
      { initialProps: { task: TASK, media: MEDIA } },
    );

    act(() => {
      vi.advanceTimersByTime(1_250);
    });
    expect(result.current.taskSeconds).toBeCloseTo(11.25, 1);
    expect(result.current.mediaSeconds).toBeCloseTo(4.25, 1);

    rerender({
      task: { ...TASK, status: 'cancelled' },
      media: { ...MEDIA, status: 'running' },
    });
    const frozen = result.current;

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.taskSeconds).toBeCloseTo(frozen.taskSeconds, 3);
    expect(result.current.mediaSeconds).toBeCloseTo(frozen.mediaSeconds, 3);
  });
});

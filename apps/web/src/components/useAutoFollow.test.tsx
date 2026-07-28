import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutoFollow } from './useAutoFollow';

describe('useAutoFollow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('pauses after manual scrolling, resets the timer, and resumes after eight seconds', () => {
    const follow = vi.fn();
    const { result, rerender } = renderHook(
      ({ targetKey }: { targetKey: number }) => useAutoFollow({ enabled: true, follow, targetKey }),
      { initialProps: { targetKey: 1 } },
    );

    act(() => vi.runOnlyPendingTimers());
    expect(follow).toHaveBeenCalledTimes(1);

    act(() => result.current.onWheel());
    rerender({ targetKey: 2 });
    act(() => vi.advanceTimersByTime(7_999));
    expect(follow).toHaveBeenCalledTimes(1);

    act(() => result.current.onWheel());
    act(() => vi.advanceTimersByTime(7_999));
    expect(follow).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1));
    expect(follow).toHaveBeenCalledTimes(2);
  });

  it('does not animate-follow while disabled', () => {
    const follow = vi.fn();
    const { rerender } = renderHook(
      ({ enabled, targetKey }: { enabled: boolean; targetKey: number }) =>
        useAutoFollow({ enabled, follow, targetKey }),
      { initialProps: { enabled: false, targetKey: 1 } },
    );

    act(() => vi.runOnlyPendingTimers());
    rerender({ enabled: false, targetKey: 2 });
    act(() => vi.runOnlyPendingTimers());
    expect(follow).not.toHaveBeenCalled();
  });
});

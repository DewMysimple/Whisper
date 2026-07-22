import type { PerformanceSample } from '../contracts/desktop';

export const PERFORMANCE_WINDOW_MS = 15_000;
export const PERFORMANCE_HISTORY_LIMIT = 80;
export const PERFORMANCE_POLL_INTERVAL_MS = PERFORMANCE_WINDOW_MS / (PERFORMANCE_HISTORY_LIMIT - 1);

export function appendPerformanceSample(
  history: PerformanceSample[],
  sample: PerformanceSample,
): PerformanceSample[] {
  const timestamp = sample.timestamp ?? Date.now();
  const normalizedSample = sample.timestamp === undefined ? { ...sample, timestamp } : sample;
  const cutoff = timestamp - PERFORMANCE_WINDOW_MS;
  return [...history, normalizedSample]
    .filter(
      (item) =>
        (item.timestamp ?? -Infinity) >= cutoff && (item.timestamp ?? Infinity) <= timestamp,
    )
    .slice(-PERFORMANCE_HISTORY_LIMIT);
}

export function samplesInPerformanceWindow(
  history: PerformanceSample[],
  endTimestamp: number,
): PerformanceSample[] {
  const cutoff = endTimestamp - PERFORMANCE_WINDOW_MS;
  return history.filter(
    (sample) =>
      (sample.timestamp ?? -Infinity) >= cutoff && (sample.timestamp ?? Infinity) <= endTimestamp,
  );
}

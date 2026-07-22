import { describe, expect, it } from 'vitest';

import type { PerformanceSample } from '../contracts/desktop';
import {
  PERFORMANCE_HISTORY_LIMIT,
  PERFORMANCE_POLL_INTERVAL_MS,
  PERFORMANCE_WINDOW_MS,
  appendPerformanceSample,
  samplesInPerformanceWindow,
} from './performanceWindow';

function sample(timestamp: number): PerformanceSample {
  return {
    source: 'worker',
    gpu: 50,
    vramUsed: 4,
    vramTotal: 16,
    cpu: 20,
    memory: 40,
    speed: null,
    memoryUsed: 12,
    memoryTotal: 32,
    gpuName: 'Test GPU',
    timestamp,
  };
}

describe('performance window', () => {
  it('uses an 80-point cadence across a real 15-second window', () => {
    expect(PERFORMANCE_WINDOW_MS).toBe(15_000);
    expect(PERFORMANCE_HISTORY_LIMIT).toBe(80);
    expect(PERFORMANCE_POLL_INTERVAL_MS).toBeCloseTo(15_000 / 79);
  });

  it('drops samples outside the latest 15 seconds and never exceeds 80 points', () => {
    let history: PerformanceSample[] = [];
    for (let index = 0; index < 100; index += 1) {
      history = appendPerformanceSample(history, sample(index * 200));
    }

    expect(history).toHaveLength(76);
    expect(history[0]?.timestamp).toBe(4_800);
    expect(history.at(-1)?.timestamp).toBe(19_800);
    expect(samplesInPerformanceWindow(history, 19_800)).toEqual(history);
  });
});

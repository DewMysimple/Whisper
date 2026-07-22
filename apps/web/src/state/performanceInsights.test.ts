import { describe, expect, it } from 'vitest';

import type { PerformanceSample } from '../contracts/desktop';
import { metricUtilization, summarizePerformanceMetric } from './performanceInsights';

function sample(overrides: Partial<PerformanceSample> = {}): PerformanceSample {
  return {
    source: 'worker',
    gpu: 20,
    vramUsed: 4,
    vramTotal: 16,
    cpu: 30,
    memory: 40,
    speed: null,
    ...overrides,
  };
}

describe('performance insights', () => {
  it('summarizes the real samples in the active metric window', () => {
    const history = [sample({ gpu: 20 }), sample({ gpu: 50 }), sample({ gpu: 80 })];

    expect(summarizePerformanceMetric(history, history[2]!, 'gpu')).toEqual({
      current: 80,
      average: 50,
      minimum: 20,
      maximum: 80,
      change: 60,
      headroom: 20,
      sampleCount: 3,
    });
  });

  it('derives VRAM utilization from the reported used and total capacity', () => {
    expect(metricUtilization(sample({ vramUsed: 6, vramTotal: 24 }), 'vram')).toBe(25);
    expect(metricUtilization(sample({ vramUsed: null, vramTotal: null }), 'vram')).toBeNull();
  });

  it('keeps unavailable metrics explicit instead of inventing values', () => {
    const unavailable = sample({ cpu: null });
    expect(summarizePerformanceMetric([unavailable], unavailable, 'cpu')).toEqual({
      current: null,
      average: null,
      minimum: null,
      maximum: null,
      change: null,
      headroom: null,
      sampleCount: 0,
    });
  });
});

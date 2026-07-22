import type { PerformanceSample } from '../contracts/desktop';

export type PerformanceMetricId = 'gpu' | 'vram' | 'cpu' | 'memory';

export interface PerformanceMetricSummary {
  current: number | null;
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  change: number | null;
  headroom: number | null;
  sampleCount: number;
}

export function metricUtilization(
  sample: PerformanceSample,
  metric: PerformanceMetricId,
): number | null {
  switch (metric) {
    case 'gpu':
      return sample.gpu;
    case 'vram':
      return sample.vramUsed !== null && sample.vramTotal
        ? (sample.vramUsed / sample.vramTotal) * 100
        : null;
    case 'cpu':
      return sample.cpu;
    case 'memory':
      return sample.memory;
  }
}

export function summarizePerformanceMetric(
  history: PerformanceSample[],
  currentSample: PerformanceSample,
  metric: PerformanceMetricId,
): PerformanceMetricSummary {
  const values = history
    .map((sample) => metricUtilization(sample, metric))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const current = metricUtilization(currentSample, metric);

  if (values.length === 0) {
    return {
      current,
      average: null,
      minimum: null,
      maximum: null,
      change: null,
      headroom: current === null ? null : Math.max(0, 100 - current),
      sampleCount: 0,
    };
  }

  const average = values.reduce((total, value) => total + value, 0) / values.length;
  return {
    current,
    average,
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    change: values.length < 2 ? null : values.at(-1)! - values[0]!,
    headroom: current === null ? null : Math.max(0, 100 - current),
    sampleCount: values.length,
  };
}

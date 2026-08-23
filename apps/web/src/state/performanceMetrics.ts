import { Cpu, HardDrive, MemoryStick, Zap } from 'lucide-react';

import type { PerformanceSample } from '../contracts/desktop';
import {
  metricUtilization,
  type PerformanceMetricId,
  type PerformanceMetricSummary,
} from './performanceInsights';

export type MetricId = PerformanceMetricId;

export interface MetricDefinition {
  id: MetricId;
  label: string;
  value: (sample: PerformanceSample) => number | null;
  display: (sample: PerformanceSample) => string;
  detail: (sample: PerformanceSample) => string;
  icon: typeof Zap;
  tone: string;
  eyebrow: string;
}

export const METRICS = [
  {
    id: 'gpu',
    label: 'GPU 负载',
    value: (sample) => metricUtilization(sample, 'gpu'),
    display: (sample) => percent(sample.gpu),
    detail: (sample) => sample.gpuName ?? '等待 NVML 采样',
    icon: Zap,
    tone: '#FF5B04',
    eyebrow: 'GPU LOAD DETAIL',
  },
  {
    id: 'vram',
    label: '显存占用',
    value: (sample) => metricUtilization(sample, 'vram'),
    display: (sample) => (sample.vramUsed === null ? '—' : `${sample.vramUsed.toFixed(1)} GB`),
    detail: (sample) =>
      sample.vramTotal === null ? '等待 NVML 采样' : `/ ${sample.vramTotal.toFixed(1)} GB`,
    icon: MemoryStick,
    tone: '#B97010',
    eyebrow: 'VRAM DETAIL',
  },
  {
    id: 'cpu',
    label: 'CPU 负载',
    value: (sample) => metricUtilization(sample, 'cpu'),
    display: (sample) => percent(sample.cpu),
    detail: () => '系统总负载',
    icon: Cpu,
    tone: '#3478C7',
    eyebrow: 'CPU LOAD DETAIL',
  },
  {
    id: 'memory',
    label: '内存占用',
    value: (sample) => metricUtilization(sample, 'memory'),
    display: (sample) => percent(sample.memory),
    detail: (sample) =>
      sample.memoryUsed != null && sample.memoryTotal != null
        ? `${sample.memoryUsed.toFixed(1)} / ${sample.memoryTotal.toFixed(1)} GB`
        : '系统内存',
    icon: HardDrive,
    tone: '#16845F',
    eyebrow: 'MEMORY DETAIL',
  },
] as const satisfies readonly MetricDefinition[];

function percent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(0)}%`;
}

export function metricValues(
  history: PerformanceSample[],
  metric: MetricDefinition,
): Array<number | null> {
  return history.map((sample) => metric.value(sample));
}

export function trendLabel(values: Array<number | null>): string {
  const usable = values.filter((value): value is number => value !== null);
  if (usable.length < 2) return '等待更多采样';
  const delta = usable.at(-1)! - usable.at(-2)!;
  if (Math.abs(delta) < 0.5) return '较上次采样稳定';
  return `较上次 ${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`;
}

export function formatMetricPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(0)}%`;
}

export function formatPointChange(value: number | null): string {
  if (value === null) return '—';
  if (Math.abs(value) < 0.5) return '0 个百分点';
  return `${value > 0 ? '+' : ''}${value.toFixed(0)} 个百分点`;
}

export function utilizationVerdict(summary: PerformanceMetricSummary): {
  label: string;
  description: string;
} {
  if (summary.current === null || summary.maximum === null || summary.average === null) {
    return { label: '等待采样', description: '当前还没有足够的本机数据用于判断资源状态。' };
  }
  if (summary.maximum >= 90) {
    return {
      label: '出现高压力',
      description: `最近 15 秒峰值达到 ${formatMetricPercent(summary.maximum)}，需要留意是否持续接近满载。`,
    };
  }
  if (summary.average >= 75) {
    return {
      label: '持续高负载',
      description: `最近 15 秒平均为 ${formatMetricPercent(summary.average)}，可用余量正在收窄。`,
    };
  }
  if (summary.maximum - (summary.minimum ?? summary.maximum) >= 35) {
    return {
      label: '负载波动明显',
      description: `低点与峰值相差 ${formatPointChange(summary.maximum - (summary.minimum ?? summary.maximum))}。`,
    };
  }
  if (summary.maximum <= 50) {
    return {
      label: '资源余量充足',
      description: `最近 15 秒峰值为 ${formatMetricPercent(summary.maximum)}，当前仍有 ${formatMetricPercent(summary.headroom)} 可用余量。`,
    };
  }
  return {
    label: '运行区间正常',
    description: `最近 15 秒平均 ${formatMetricPercent(summary.average)}，峰值 ${formatMetricPercent(summary.maximum)}。`,
  };
}

export function capacityDetail(
  metric: MetricId,
  sample: PerformanceSample,
  summary: PerformanceMetricSummary,
): { value: string; note: string } {
  if (metric === 'vram' && sample.vramUsed !== null && sample.vramTotal !== null) {
    return {
      value: `${Math.max(0, sample.vramTotal - sample.vramUsed).toFixed(1)} GB`,
      note: `显存可用 · 总计 ${sample.vramTotal.toFixed(1)} GB`,
    };
  }
  if (metric === 'memory' && sample.memoryUsed != null && sample.memoryTotal != null) {
    return {
      value: `${Math.max(0, sample.memoryTotal - sample.memoryUsed).toFixed(1)} GB`,
      note: `系统内存可用 · 总计 ${sample.memoryTotal.toFixed(1)} GB`,
    };
  }
  return {
    value: formatMetricPercent(summary.headroom),
    note: metric === 'cpu' ? '系统总体空闲余量' : '距离满负载的余量',
  };
}

export function relatedDetail(
  metric: MetricId,
  sample: PerformanceSample,
): { value: string; note: string } {
  switch (metric) {
    case 'gpu':
      return {
        value:
          sample.vramUsed !== null && sample.vramTotal !== null
            ? `${sample.vramUsed.toFixed(1)} / ${sample.vramTotal.toFixed(1)} GB`
            : '—',
        note: '同一时刻显存占用',
      };
    case 'vram':
      return { value: formatMetricPercent(sample.gpu), note: '同一时刻 GPU 负载' };
    case 'cpu':
      return {
        value:
          sample.memoryUsed != null && sample.memoryTotal != null
            ? `${sample.memoryUsed.toFixed(1)} / ${sample.memoryTotal.toFixed(1)} GB`
            : formatMetricPercent(sample.memory),
        note: '同一时刻系统内存',
      };
    case 'memory':
      return { value: formatMetricPercent(sample.cpu), note: '同一时刻 CPU 负载' };
  }
}

export function currentReadingNote(metric: MetricId, sample: PerformanceSample): string {
  if (metric === 'vram' && sample.vramUsed !== null && sample.vramTotal !== null) {
    return `${sample.vramUsed.toFixed(1)} / ${sample.vramTotal.toFixed(1)} GB`;
  }
  if (metric === 'memory' && sample.memoryUsed != null && sample.memoryTotal != null) {
    return `${sample.memoryUsed.toFixed(1)} / ${sample.memoryTotal.toFixed(1)} GB`;
  }
  return METRICS.find((item) => item.id === metric)?.detail(sample) ?? '等待采样';
}

export interface TelemetrySpec {
  label: string;
  value: string;
  note: string;
  wide?: boolean;
}

function formatTelemetryNumber(
  value: number | null | undefined,
  suffix: string,
  digits = 0,
): string {
  return value == null ? '—' : `${value.toFixed(digits)} ${suffix}`;
}

function formatGib(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toFixed(value < 1 ? 2 : 1)} GB`;
}

function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days > 0 ? `${days} 天 ${hours} 小时` : `${hours} 小时 ${minutes} 分`;
}

export function metricTelemetry(metric: MetricId, sample: PerformanceSample): TelemetrySpec[] {
  switch (metric) {
    case 'gpu':
      return [
        {
          label: 'GPU 温度',
          value: formatTelemetryNumber(sample.gpuTemperature, '°C'),
          note: 'NVML 核心温度',
        },
        {
          label: '核心频率',
          value: formatTelemetryNumber(sample.gpuClockMhz, 'MHz'),
          note: '当前图形核心时钟',
        },
        {
          label: '显存频率',
          value: formatTelemetryNumber(sample.gpuMemoryClockMhz, 'MHz'),
          note: '当前显存时钟',
        },
        {
          label: '实时功耗',
          value:
            sample.gpuPowerWatts == null
              ? '—'
              : `${sample.gpuPowerWatts.toFixed(1)} / ${sample.gpuPowerLimitWatts?.toFixed(0) ?? '—'} W`,
          note: '当前功耗 / 强制功耗上限',
        },
        {
          label: '风扇转速',
          value: formatMetricPercent(sample.gpuFanPercent ?? null),
          note: sample.gpuFanPercent === 0 ? '0% 可表示零转速策略' : 'NVML 风扇占空比',
        },
        {
          label: '性能状态',
          value: sample.gpuPerformanceState ?? '—',
          note: 'P0 性能最高，数字越大越省电',
        },
        {
          label: '显存控制器',
          value: formatMetricPercent(sample.gpuMemoryController ?? null),
          note: '不是显存容量占用率',
        },
        {
          label: 'NVIDIA 驱动',
          value: sample.gpuDriverVersion ?? '—',
          note: sample.gpuName ?? '等待设备信息',
        },
      ];
    case 'vram':
      return [
        { label: '显存已用', value: formatGib(sample.vramUsed), note: '专用 GPU 显存' },
        {
          label: '显存可用',
          value:
            sample.vramUsed == null || sample.vramTotal == null
              ? '—'
              : formatGib(Math.max(0, sample.vramTotal - sample.vramUsed)),
          note: '总量减去当前已用',
        },
        { label: '显存总量', value: formatGib(sample.vramTotal), note: 'NVML 设备容量' },
        {
          label: '显存控制器',
          value: formatMetricPercent(sample.gpuMemoryController ?? null),
          note: '显存读写活动强度',
        },
        {
          label: 'GPU 温度',
          value: formatTelemetryNumber(sample.gpuTemperature, '°C'),
          note: '显存压力的关联温度',
          wide: true,
        },
        {
          label: 'NVIDIA 驱动',
          value: sample.gpuDriverVersion ?? '—',
          note: sample.gpuName ?? '等待设备信息',
          wide: true,
        },
      ];
    case 'cpu':
      return [
        {
          label: '处理器',
          value: sample.cpuName ?? '—',
          note: 'Windows 处理器名称',
          wide: true,
        },
        {
          label: '系统报告频率',
          value:
            sample.cpuFrequencyMhz == null
              ? '—'
              : `${(sample.cpuFrequencyMhz / 1000).toFixed(2)} GHz`,
          note: '可能与瞬时 Boost 频率不同',
        },
        {
          label: '物理核心',
          value: formatTelemetryNumber(sample.cpuPhysicalCores, '核'),
          note: '系统报告的物理核心数',
        },
        {
          label: '逻辑处理器',
          value: formatTelemetryNumber(sample.cpuLogicalCores, '线程'),
          note: 'Windows 可调度处理器数',
        },
        {
          label: '系统进程',
          value: formatTelemetryNumber(sample.systemProcessCount, '个'),
          note: '当前活动进程数量',
        },
        {
          label: '系统运行时间',
          value: formatUptime(sample.systemUptimeSeconds),
          note: '从本次 Windows 启动计算',
          wide: true,
        },
        {
          label: 'Worker 线程',
          value: formatTelemetryNumber(sample.workerThreadCount, '个'),
          note: '当前转录 Worker 进程',
          wide: true,
        },
        {
          label: 'Worker 句柄',
          value: formatTelemetryNumber(sample.workerHandleCount, '个'),
          note: '当前 Windows 句柄数量',
          wide: true,
        },
      ];
    case 'memory':
      return [
        { label: '内存已用', value: formatGib(sample.memoryUsed), note: '系统当前已使用' },
        {
          label: '内存可用',
          value: formatGib(sample.memoryAvailable),
          note: '可立即提供给应用',
        },
        { label: '物理内存', value: formatGib(sample.memoryTotal), note: '系统可见总容量' },
        {
          label: '交换空间',
          value:
            sample.swapUsed == null
              ? '—'
              : `${formatGib(sample.swapUsed)} / ${formatGib(sample.swapTotal)}`,
          note: '当前已用 / 总分页空间',
        },
        {
          label: 'Worker 常驻内存',
          value: formatGib(sample.workerRss),
          note: '转录 Worker RSS',
          wide: true,
        },
        {
          label: '系统进程',
          value: formatTelemetryNumber(sample.systemProcessCount, '个'),
          note: '当前内存竞争上下文',
          wide: true,
        },
      ];
  }
}

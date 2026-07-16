import { Cpu, MemoryStick, Microchip, Zap } from 'lucide-react';

import type { PerformanceSample } from '../contracts/desktop';
import { useWorkspace } from '../state/workspace';

function Sparkline({ values }: { values: number[] }) {
  const points = values.length > 1 ? values : [0, values[0] ?? 0];
  const coordinates = points
    .map((value, index) => {
      const x = (index / Math.max(1, points.length - 1)) * 100;
      const y = 30 - (Math.max(0, Math.min(100, value)) / 100) * 28;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg aria-hidden="true" className="sparkline" preserveAspectRatio="none" viewBox="0 0 100 32">
      <polyline fill="none" points={coordinates} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function historyValues(
  history: PerformanceSample[],
  read: (sample: PerformanceSample) => number | null,
): number[] {
  return history.map(read).filter((value): value is number => value !== null);
}

export function PerformanceStrip() {
  const performance = useWorkspace((state) => state.performance);
  const history = useWorkspace((state) => state.performanceHistory);
  const model = useWorkspace((state) => state.model);
  const items = [
    {
      label: 'GPU',
      value: performance.gpu === null ? '—' : `${performance.gpu.toFixed(0)}%`,
      detail: performance.gpuName ?? model.device ?? '等待 NVML',
      icon: Zap,
      tone: 'coral',
      history: historyValues(history, (sample) => sample.gpu),
    },
    {
      label: '显存',
      value: performance.vramUsed === null ? '—' : `${performance.vramUsed.toFixed(1)} GB`,
      detail:
        performance.vramTotal === null ? '等待 NVML' : `/ ${performance.vramTotal.toFixed(1)} GB`,
      icon: MemoryStick,
      tone: 'aqua',
      history: historyValues(history, (sample) =>
        sample.vramUsed !== null && sample.vramTotal
          ? (sample.vramUsed / sample.vramTotal) * 100
          : null,
      ),
    },
    {
      label: 'CPU',
      value: performance.cpu === null ? '—' : `${performance.cpu.toFixed(0)}%`,
      detail: '系统总负载',
      icon: Cpu,
      tone: 'violet',
      history: historyValues(history, (sample) => sample.cpu),
    },
    {
      label: '内存',
      value: performance.memory === null ? '—' : `${performance.memory.toFixed(0)}%`,
      detail:
        performance.memoryUsed == null || performance.memoryTotal == null
          ? '系统内存'
          : `${performance.memoryUsed.toFixed(1)} / ${performance.memoryTotal.toFixed(1)} GB`,
      icon: Microchip,
      tone: 'lime',
      history: historyValues(history, (sample) => sample.memory),
    },
  ];

  return (
    <section className="performance-strip" aria-label="本机实时性能">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div className="metric-card" key={item.label}>
            <div className={`metric-icon ${item.tone}`}>
              <Icon size={17} />
            </div>
            <span>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
            </span>
            <em>{item.detail}</em>
            <Sparkline values={item.history} />
          </div>
        );
      })}
    </section>
  );
}

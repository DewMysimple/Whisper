import {
  Activity,
  CheckCircle2,
  Clock3,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Radio,
  ServerCog,
  Zap,
} from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';

import type { PerformanceSample } from '../contracts/desktop';
import {
  metricUtilization,
  summarizePerformanceMetric,
  type PerformanceMetricId,
  type PerformanceMetricSummary,
} from '../state/performanceInsights';
import {
  PERFORMANCE_HISTORY_LIMIT,
  PERFORMANCE_WINDOW_MS,
  samplesInPerformanceWindow,
} from '../state/performanceWindow';
import { useWorkspace } from '../state/workspace';
import { HelpTip } from './HelpTip';

type MetricId = PerformanceMetricId;

interface MetricDefinition {
  id: MetricId;
  label: string;
  value: (sample: PerformanceSample) => number | null;
  display: (sample: PerformanceSample) => string;
  detail: (sample: PerformanceSample) => string;
  icon: typeof Zap;
  tone: string;
  eyebrow: string;
}

const METRICS = [
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

function metricValues(
  history: PerformanceSample[],
  metric: MetricDefinition,
): Array<number | null> {
  return history.map((sample) => metric.value(sample));
}

function trendLabel(values: Array<number | null>): string {
  const usable = values.filter((value): value is number => value !== null);
  if (usable.length < 2) return '等待更多采样';
  const delta = usable.at(-1)! - usable.at(-2)!;
  if (Math.abs(delta) < 0.5) return '较上次采样稳定';
  return `较上次 ${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`;
}

function formatMetricPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(0)}%`;
}

function formatPointChange(value: number | null): string {
  if (value === null) return '—';
  if (Math.abs(value) < 0.5) return '0 个百分点';
  return `${value > 0 ? '+' : ''}${value.toFixed(0)} 个百分点`;
}

function utilizationVerdict(summary: PerformanceMetricSummary): {
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

function capacityDetail(
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

function relatedDetail(
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

function currentReadingNote(metric: MetricId, sample: PerformanceSample): string {
  if (metric === 'vram' && sample.vramUsed !== null && sample.vramTotal !== null) {
    return `${sample.vramUsed.toFixed(1)} / ${sample.vramTotal.toFixed(1)} GB`;
  }
  if (metric === 'memory' && sample.memoryUsed != null && sample.memoryTotal != null) {
    return `${sample.memoryUsed.toFixed(1)} / ${sample.memoryTotal.toFixed(1)} GB`;
  }
  return METRICS.find((item) => item.id === metric)?.detail(sample) ?? '等待采样';
}

interface TelemetrySpec {
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

function metricTelemetry(metric: MetricId, sample: PerformanceSample): TelemetrySpec[] {
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

function Heatmap({
  history,
  metric,
  endTimestamp,
}: {
  history: PerformanceSample[];
  metric: MetricDefinition;
  endTimestamp: number;
}) {
  const columns = Array<number | null>(PERFORMANCE_HISTORY_LIMIT).fill(null);
  const windowStart = endTimestamp - PERFORMANCE_WINDOW_MS;
  for (const sample of samplesInPerformanceWindow(history, endTimestamp)) {
    const elapsed = (sample.timestamp ?? endTimestamp) - windowStart;
    const columnIndex = Math.max(
      0,
      Math.min(
        PERFORMANCE_HISTORY_LIMIT - 1,
        Math.round((elapsed / PERFORMANCE_WINDOW_MS) * (PERFORMANCE_HISTORY_LIMIT - 1)),
      ),
    );
    columns[columnIndex] = metric.value(sample);
  }
  const rows = 20;

  return (
    <div
      className="heatmap"
      role="img"
      aria-label={`${metric.label} 最近 15 秒本机性能趋势，80 乘 20 个正方形采样格`}
    >
      {columns.map((value, columnIndex) => {
        const activeRows = value === null ? 0 : Math.max(1, Math.round((value / 100) * rows));
        return (
          <div className="heat-column" key={columnIndex}>
            {Array.from({ length: rows }, (_, rowIndex) => (
              <span
                className={rowIndex >= rows - activeRows ? 'is-active' : ''}
                key={rowIndex}
                style={
                  rowIndex >= rows - activeRows
                    ? ({
                        '--heat-alpha': `${0.34 + ((rowIndex + 1) / rows) * 0.66}`,
                      } as CSSProperties)
                    : undefined
                }
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function UtilizationBar({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone: string;
}) {
  const safe = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="utilization-row">
      <div>
        <span>{label}</span>
        <strong>{value === null ? '—' : `${value.toFixed(0)}%`}</strong>
      </div>
      <div className="utilization-track" aria-hidden="true">
        <span style={{ background: tone, width: `${safe}%` }} />
      </div>
    </div>
  );
}

export function PerformanceView() {
  const performance = useWorkspace((state) => state.performance);
  const history = useWorkspace((state) => state.performanceHistory);
  const hostStatus = useWorkspace((state) => state.hostStatus);
  const environment = useWorkspace((state) => state.environment);
  const model = useWorkspace((state) => state.model);
  const tasks = useWorkspace((state) => state.tasks);
  const [activeMetricId, setActiveMetricId] = useState<MetricId>('gpu');
  const activeMetric = METRICS.find((metric) => metric.id === activeMetricId) ?? METRICS[0];
  const performanceTimestamp = performance.timestamp ?? Date.now();
  const windowHistory = useMemo(
    () => samplesInPerformanceWindow(history, performanceTimestamp),
    [history, performanceTimestamp],
  );
  const vramPercent = METRICS[1].value(performance);
  const values = useMemo(
    () => metricValues(windowHistory, activeMetric),
    [activeMetric, windowHistory],
  );
  const metricSummary = useMemo(
    () => summarizePerformanceMetric(windowHistory, performance, activeMetricId),
    [activeMetricId, performance, windowHistory],
  );
  const verdict = utilizationVerdict(metricSummary);
  const capacity = capacityDetail(activeMetricId, performance, metricSummary);
  const related = relatedDetail(activeMetricId, performance);
  const telemetry = metricTelemetry(activeMetricId, performance);
  const ActiveIcon = activeMetric.icon;
  const sampledAt = performance.timestamp
    ? new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(performance.timestamp)
    : '等待采样';
  const detailStats = [
    { label: '15 秒平均', value: formatMetricPercent(metricSummary.average) },
    { label: '15 秒峰值', value: formatMetricPercent(metricSummary.maximum) },
    { label: '15 秒低点', value: formatMetricPercent(metricSummary.minimum) },
    { label: '窗口变化', value: formatPointChange(metricSummary.change) },
  ];
  const runningTask = tasks.find((task) => task.status === 'running');
  const queuedTasks = tasks.filter((task) => task.status === 'queued');
  const activeTask = runningTask ?? queuedTasks[0];
  const waitingCount = queuedTasks.filter((task) => task.id !== activeTask?.id).length;
  const activeInputName = activeTask?.activeInput?.split(/[/\\]/).at(-1);

  return (
    <div
      className="performance-page"
      style={{ '--metric-accent': activeMetric.tone } as CSSProperties}
    >
      <section className="insight-card performance-trend">
        <header className="insight-heading">
          <div>
            <p className="step-label">LIVE PERFORMANCE</p>
            <div className="heading-with-help">
              <h2>实时性能趋势</h2>
              <HelpTip id="performance-sampling-help" label="查看性能采样说明">
                数据来自 Python Worker 的正式本机采样，不经网络传输。
              </HelpTip>
            </div>
          </div>
          <div className="live-chip">
            <Radio size={14} />
            {hostStatus.state === 'ready' ? '实时采样' : '等待 Worker'}
          </div>
        </header>

        <div className="trend-chart">
          <div className="y-axis" aria-hidden="true">
            <span>100</span>
            <span>75</span>
            <span>50</span>
            <span>25</span>
            <span>0</span>
          </div>
          <div className="trend-canvas">
            <Heatmap
              endTimestamp={performanceTimestamp}
              history={windowHistory}
              metric={activeMetric}
            />
            <div className="x-axis" aria-hidden="true">
              <span>15s</span>
              <span>7.5s</span>
              <span>现在</span>
            </div>
          </div>
        </div>

        <div className="metric-selector">
          {METRICS.map((metric) => {
            const Icon = metric.icon;
            return (
              <button
                aria-pressed={activeMetricId === metric.id}
                className={activeMetricId === metric.id ? 'is-active' : ''}
                key={metric.id}
                onClick={() => setActiveMetricId(metric.id)}
                style={{ '--item-accent': metric.tone } as CSSProperties}
                type="button"
              >
                <span className="metric-selector-icon">
                  <Icon size={17} />
                </span>
                <span>
                  <small>{metric.label}</small>
                  <strong>{metric.display(performance)}</strong>
                  <em>
                    {activeMetricId === metric.id ? trendLabel(values) : metric.detail(performance)}
                  </em>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="insight-card task-progress-monitor" aria-labelledby="task-progress-title">
        <header className="task-progress-heading">
          <div>
            <p className="step-label">CURRENT TASK</p>
            <h2 id="task-progress-title">任务进度监视</h2>
          </div>
          <span className={`task-progress-state ${activeTask ? 'is-active' : ''}`}>
            <Radio size={14} />
            {activeTask?.status === 'running'
              ? '正在执行'
              : activeTask?.status === 'queued'
                ? '等待调度'
                : '当前空闲'}
          </span>
        </header>
        {activeTask ? (
          <div className="task-progress-body">
            <div className="task-progress-identity">
              <div>
                <strong>{activeTask.title}</strong>
                <span>{activeTask.stage}</span>
              </div>
              <strong className="task-progress-percent">{activeTask.progress}%</strong>
            </div>
            <div
              aria-label={`当前任务进度 ${activeTask.progress}%`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={activeTask.progress}
              className="task-progress-track"
              role="progressbar"
            >
              <span style={{ width: `${activeTask.progress}%` }} />
            </div>
            <div className="task-progress-facts">
              <span>
                <Clock3 size={15} /> 已用时 {activeTask.elapsed}
              </span>
              <span>{activeTask.sourceCount} 个媒体文件</span>
              <span className="task-progress-input">
                {activeInputName ? `当前：${activeInputName}` : '等待媒体处理信息'}
              </span>
              {waitingCount > 0 && <span>另有 {waitingCount} 项等待</span>}
            </div>
          </div>
        ) : (
          <div className="task-progress-empty">
            <Activity size={20} />
            <div>
              <strong>当前没有正在执行的任务</strong>
              <span>开始转录后，可在这里快速查看真实任务进度。</span>
            </div>
          </div>
        )}
      </section>

      <div className="performance-lower">
        <section className="insight-card hardware-card">
          <header className="compact-heading">
            <div>
              <p className="step-label">HARDWARE</p>
              <h3>资源概览</h3>
            </div>
            <Gauge size={21} />
          </header>
          <div className="hardware-name">
            <span className="hardware-icon">
              <ServerCog size={20} />
            </span>
            <span>
              <strong>{performance.gpuName ?? '本机计算设备'}</strong>
              <small>{performance.source.toUpperCase()} SAMPLE</small>
            </span>
          </div>
          <div className="utilization-list">
            <UtilizationBar label="GPU" tone="#FF5B04" value={performance.gpu} />
            <UtilizationBar label="显存" tone="#B97010" value={vramPercent} />
            <UtilizationBar label="CPU" tone="#3478C7" value={performance.cpu} />
            <UtilizationBar label="内存" tone="#16845F" value={performance.memory} />
          </div>
        </section>

        <section className="insight-card health-card">
          <header className="compact-heading">
            <div>
              <p className="step-label">SYSTEM HEALTH</p>
              <h3>运行链路</h3>
            </div>
            <Activity size={21} />
          </header>
          <div className="health-score">
            <span>{hostStatus.state === 'ready' ? '正常' : '待检'}</span>
            <div>
              <strong>{hostStatus.state === 'ready' ? '本地链路已就绪' : '等待本地链路'}</strong>
              <small>Worker、IPC 与模型状态</small>
            </div>
          </div>
          <div className="health-list">
            <div>
              <CheckCircle2 size={16} />
              <span>Python Worker</span>
              <strong>{hostStatus.state}</strong>
            </div>
            <div>
              <CheckCircle2 size={16} />
              <span>Desktop IPC</span>
              <strong>{hostStatus.launchKind}</strong>
            </div>
            <div>
              <CheckCircle2 size={16} />
              <span>模型状态</span>
              <strong>{model.state}</strong>
            </div>
            <div>
              <CheckCircle2 size={16} />
              <span>Python 环境</span>
              <strong>{environment?.available ? 'available' : 'pending'}</strong>
            </div>
          </div>
          <p className="sample-note">
            当前会话已保留 {windowHistory.length} / {PERFORMANCE_HISTORY_LIMIT} 次趋势采样 ·
            时间范围 15s 至现在
          </p>
        </section>
      </div>

      <section
        aria-labelledby="metric-detail-title"
        className="insight-card metric-detail"
        style={{ '--detail-accent': activeMetric.tone } as CSSProperties}
      >
        <header className="metric-detail-heading">
          <div className="metric-detail-identity">
            <span className="metric-detail-icon">
              <ActiveIcon size={20} />
            </span>
            <div>
              <p className="step-label">{activeMetric.eyebrow}</p>
              <h3 id="metric-detail-title">{activeMetric.label}详情</h3>
            </div>
          </div>
          <span className="metric-detail-health">
            {hostStatus.state === 'ready' ? '实时可用' : '等待本地链路'}
          </span>
        </header>
        <div className="metric-diagnostic">
          <div className="metric-current-reading">
            <span>当前使用率</span>
            <strong>{formatMetricPercent(metricSummary.current)}</strong>
            <small>{currentReadingNote(activeMetricId, performance)}</small>
          </div>
          <div className="metric-verdict">
            <span>15 秒判断</span>
            <strong>{verdict.label}</strong>
            <p>{verdict.description}</p>
          </div>
          <div
            aria-label={`${activeMetric.label} 当前 ${formatMetricPercent(metricSummary.current)}，15 秒平均 ${formatMetricPercent(metricSummary.average)}，峰值 ${formatMetricPercent(metricSummary.maximum)}`}
            className="metric-load-profile"
            role="img"
          >
            <div className="metric-load-track">
              <span
                className="metric-load-current"
                style={{ width: `${Math.max(0, Math.min(100, metricSummary.current ?? 0))}%` }}
              />
              <i
                className="metric-load-average"
                style={{ left: `${Math.max(0, Math.min(100, metricSummary.average ?? 0))}%` }}
              />
              <i
                className="metric-load-peak"
                style={{ left: `${Math.max(0, Math.min(100, metricSummary.maximum ?? 0))}%` }}
              />
            </div>
            <div className="metric-load-legend" aria-hidden="true">
              <span>0%</span>
              <span>平均</span>
              <span>峰值</span>
              <span>100%</span>
            </div>
          </div>
        </div>
        <div className="metric-stat-grid" aria-label="最近 15 秒统计">
          {detailStats.map((stat) => (
            <div className="metric-stat" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </div>
        <div className="metric-context-grid">
          <div className="metric-context-card">
            <span>可用余量</span>
            <strong>{capacity.value}</strong>
            <small>{capacity.note}</small>
          </div>
          <div className="metric-context-card">
            <span>关联资源</span>
            <strong>{related.value}</strong>
            <small>{related.note}</small>
          </div>
        </div>
        <div className="metric-telemetry-heading">
          <div>
            <span>LIVE TELEMETRY</span>
            <strong>硬件与进程遥测</strong>
          </div>
          <small>
            {activeMetricId === 'gpu' || activeMetricId === 'vram' ? 'NVML' : 'WINDOWS / PSUTIL'}
          </small>
        </div>
        <div
          className="metric-telemetry-grid"
          aria-label={`${activeMetric.label}实时硬件与进程指标`}
        >
          {telemetry.map((spec) => (
            <div className={`metric-telemetry-card${spec.wide ? ' is-wide' : ''}`} key={spec.label}>
              <span>{spec.label}</span>
              <strong>{spec.value}</strong>
              <small>{spec.note}</small>
            </div>
          ))}
        </div>
        <p className="metric-detail-note">
          {performance.source.toUpperCase()} 实时采样 · {metricSummary.sampleCount} /{' '}
          {PERFORMANCE_HISTORY_LIMIT} 个有效样本 · 最新 {sampledAt}
          {performance.speed === null ? '' : ` · 推理速度 ${performance.speed.toFixed(1)}×`}
          {hostStatus.pid === null ? '' : ` · Worker PID ${hostStatus.pid}`}
        </p>
      </section>
    </div>
  );
}

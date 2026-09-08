import { Activity, CheckCircle2, Clock3, Gauge, Radio, ServerCog } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';

import type { PerformanceSample } from '../contracts/desktop';
import { getModelLabel } from '../data/models';
import { getPreset } from '../data/presets';
import { summarizePerformanceMetric } from '../state/performanceInsights';
import {
  PERFORMANCE_HISTORY_LIMIT,
  PERFORMANCE_WINDOW_MS,
  samplesInPerformanceWindow,
} from '../state/performanceWindow';
import {
  formatDurationSummary,
  formatMediaDuration,
  taskDurationSummary,
} from '../state/mediaDuration';
import { formatTaskCreatedAt } from '../state/taskHistory';
import { useWorkspace } from '../state/workspace';
import {
  capacityDetail,
  currentReadingNote,
  formatMetricPercent,
  formatPointChange,
  metricTelemetry,
  metricValues,
  METRICS,
  relatedDetail,
  trendLabel,
  type MetricDefinition,
  type MetricId,
  utilizationVerdict,
} from '../state/performanceMetrics';
import { formatElapsedSeconds, useTaskTiming } from './useTaskTiming';

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
  const activeMediaStates = activeTask?.mediaStates ?? [];
  const processingTotal = activeTask?.processingCount ?? activeTask?.sourceCount ?? 0;
  const runningMediaIndex = activeMediaStates.findIndex((media) => media.status === 'running');
  const currentMediaNumber =
    activeTask?.status === 'running'
      ? (activeTask.currentMediaIndex ?? (runningMediaIndex >= 0 ? runningMediaIndex + 1 : 0))
      : 0;
  const currentMedia =
    activeMediaStates.find((media) => media.status === 'running') ??
    activeMediaStates[
      Math.max(0, Math.min(activeMediaStates.length - 1, (activeTask?.currentMediaIndex ?? 1) - 1))
    ];
  const activeInputName = (currentMedia?.path ?? activeTask?.activeInput)?.split(/[/\\]/).at(-1);
  const timing = useTaskTiming(activeTask, currentMedia);
  const mediaProgress = currentMedia?.progress ?? null;

  return (
    <div
      className="performance-page"
      style={{ '--metric-accent': activeMetric.tone } as CSSProperties}
    >
      <section className="insight-card performance-trend">
        <header className="insight-heading">
          <div>
            <p className="step-label">LIVE PERFORMANCE</p>
            <h2>实时性能趋势</h2>
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
                <p className="step-label">LIVE TASK MONITOR</p>
                <strong>{activeTask.title}</strong>
                <span>{activeTask.stage}</span>
              </div>
            </div>
            <div className="task-progress-meta" aria-label="当前任务日期版本与模型">
              <span>{formatTaskCreatedAt(activeTask.createdAt)}</span>
              <span>{getPreset(activeTask.presetId).label}</span>
              <span>{getModelLabel(activeTask.modelId)}</span>
            </div>
            <div className="task-progress-lanes">
              <div className="task-progress-lane">
                <div>
                  <span>整体任务进度</span>
                  <strong>
                    {Math.min(currentMediaNumber, processingTotal)} / {processingTotal} ·{' '}
                    {activeTask.progress}%
                  </strong>
                </div>
                <div
                  aria-label={`整体任务进度 ${activeTask.progress}%`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={activeTask.progress}
                  className="task-progress-track"
                  role="progressbar"
                >
                  <span style={{ width: `${activeTask.progress}%` }} />
                </div>
              </div>
              <div className="task-progress-lane is-media">
                <div>
                  <span>{activeInputName ? `当前媒体 · ${activeInputName}` : '当前媒体'}</span>
                  <strong>{mediaProgress === null ? '—' : `${Math.round(mediaProgress)}%`}</strong>
                </div>
                <div
                  aria-label={
                    mediaProgress === null
                      ? '当前媒体进度未知'
                      : `当前媒体进度 ${Math.round(mediaProgress)}%`
                  }
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={mediaProgress ?? undefined}
                  className={`task-progress-track ${
                    mediaProgress === null ? 'is-indeterminate' : ''
                  }`}
                  role="progressbar"
                >
                  {mediaProgress !== null && (
                    <span style={{ width: `${Math.max(0, Math.min(100, mediaProgress))}%` }} />
                  )}
                </div>
              </div>
            </div>
            <div className="task-progress-facts">
              <span>
                <Clock3 size={15} /> 总耗时 {formatElapsedSeconds(timing.taskSeconds)}
              </span>
              <span>{activeTask.sourceCount} 个媒体文件</span>
              <span>{formatDurationSummary(taskDurationSummary(activeTask))}</span>
              <span>
                当前媒体耗时 {formatElapsedSeconds(timing.mediaSeconds)} / 时长{' '}
                {formatMediaDuration(currentMedia?.durationSeconds)}
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

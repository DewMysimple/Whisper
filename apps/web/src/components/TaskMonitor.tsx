import {
  Check,
  CircleDashed,
  Clock3,
  FileAudio,
  FolderOpen,
  FolderTree,
  LoaderCircle,
  Radio,
  Square,
} from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useCallback, useRef, useState } from 'react';

import type { TaskMediaSnapshot, TaskSnapshot } from '../contracts/desktop';
import { getModelLabel } from '../data/models';
import { getPreset } from '../data/presets';
import {
  formatDurationSummary,
  formatMediaDuration,
  taskDurationSummary,
} from '../state/mediaDuration';
import { formatTaskCreatedAt } from '../state/taskHistory';
import { taskSourceSummary } from '../state/taskSourceSummary';
import { useWorkspace } from '../state/workspace';
import { ConfirmDialog } from './ConfirmDialog';
import { useAutoFollow } from './useAutoFollow';
import { formatElapsedSeconds, useTaskTiming } from './useTaskTiming';

const PROCESS_STEPS = [
  { label: '输入与模型准备', start: 0, end: 18 },
  { label: '媒体转录', start: 19, end: 78 },
  { label: '文本后处理', start: 79, end: 88 },
  { label: '写入输出', start: 89, end: 96 },
  { label: '任务汇总', start: 97, end: 100 },
] as const;

function fileName(path: string): string {
  return path.split(/[/\\]/).at(-1) ?? path;
}

function mediaStatusLabel(media: TaskMediaSnapshot): string {
  if (media.status === 'completed') return '已完成';
  if (media.status === 'running') return media.stage;
  if (media.status === 'failed') return '处理失败';
  if (media.status === 'skipped') return '已跳过';
  return '等待处理';
}

function activeTaskFrom(tasks: TaskSnapshot[]): TaskSnapshot | undefined {
  return (
    tasks.find((task) => task.status === 'running') ??
    [...tasks].reverse().find((task) => task.status === 'queued')
  );
}

export function TaskMonitor() {
  const tasks = useWorkspace((state) => state.tasks);
  const monitoredTaskId = useWorkspace((state) => state.monitoredTaskId);
  const cancelTask = useWorkspace((state) => state.cancelTask);
  const openTaskOutputDirectory = useWorkspace((state) => state.openTaskOutputDirectory);
  const [terminationOpen, setTerminationOpen] = useState(false);
  const mediaRowRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const activeTask = tasks.find((task) => task.id === monitoredTaskId) ?? activeTaskFrom(tasks);
  const waitingCount = tasks.filter(
    (task) =>
      task.status === 'queued' &&
      task.id !== activeTask?.id &&
      (activeTask?.status === 'running' || activeTask?.status === 'queued'),
  ).length;
  const mediaStates: TaskMediaSnapshot[] =
    activeTask?.mediaStates ??
    (activeTask?.mediaPaths ?? []).map((path) => ({
      path,
      status: 'pending' as const,
      progress: 0,
      stage: '等待处理',
      elapsedSeconds: 0,
    }));
  const runningMediaIndex = mediaStates.findIndex((media) => media.status === 'running');
  const currentIndex =
    activeTask?.status === 'running'
      ? (activeTask.currentMediaIndex ?? (runningMediaIndex >= 0 ? runningMediaIndex + 1 : 0))
      : 0;
  const currentMedia =
    mediaStates.find((media) => media.status === 'running') ??
    mediaStates[Math.max(0, Math.min(mediaStates.length - 1, currentIndex - 1))];
  const timing = useTaskTiming(activeTask, currentMedia);
  const followCurrentMedia = useCallback(() => {
    const mediaRow = mediaRowRef.current;
    if (mediaRow === null || typeof mediaRow.scrollIntoView !== 'function') return;
    mediaRow.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'center',
    });
  }, [reducedMotion]);
  const mediaFollowHandlers = useAutoFollow({
    enabled: activeTask?.status === 'running' && currentMedia !== undefined,
    follow: followCurrentMedia,
    targetKey: currentMedia?.path ?? null,
  });

  if (activeTask === undefined) {
    return (
      <section className="task-monitor-empty" aria-labelledby="task-monitor-empty-title">
        <span aria-hidden="true">
          <Radio size={24} />
        </span>
        <div>
          <p className="step-label">LIVE TASK MONITOR</p>
          <h2 id="task-monitor-empty-title">当前没有正在执行的任务</h2>
          <p>开始转录后，这里会展开真实媒体清单、逐文件进度和完整处理阶段。</p>
        </div>
      </section>
    );
  }

  const processingTotal = activeTask.processingCount ?? activeTask.sourceCount;
  const sourceSummary = taskSourceSummary(activeTask);
  const outputPaths = [
    ...new Set([
      ...(activeTask.outputs ?? []),
      ...mediaStates.flatMap((media) => media.outputPaths ?? []),
    ]),
  ];
  const isActive = activeTask.status === 'running' || activeTask.status === 'queued';
  const statusLabel =
    activeTask.status === 'running'
      ? '正在执行'
      : activeTask.status === 'queued'
        ? '等待调度'
        : activeTask.status === 'completed'
          ? '任务完成'
          : activeTask.status === 'cancelled'
            ? '任务已终止'
            : '任务失败';

  return (
    <>
      <div className="task-monitor-layout">
        <section className="task-monitor-hero" aria-labelledby="task-monitor-title">
          <header>
            <div>
              <p className="step-label">LIVE TASK MONITOR</p>
              <h2 id="task-monitor-title">{activeTask.title}</h2>
            </div>
            <div className="task-monitor-heading-actions">
              {isActive && (
                <button
                  className="task-monitor-stop"
                  onClick={() => setTerminationOpen(true)}
                  type="button"
                >
                  <Square fill="currentColor" size={12} /> 终止任务
                </button>
              )}
              <span className={`task-monitor-live ${activeTask.status}`}>
                {activeTask.status === 'running' ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <CircleDashed size={15} />
                )}
                {statusLabel}
              </span>
            </div>
          </header>
          <div className="task-monitor-meta">
            <span>{formatTaskCreatedAt(activeTask.createdAt)}</span>
            <span>{getPreset(activeTask.presetId).label}</span>
            <span>{getModelLabel(activeTask.modelId)}</span>
            <span>
              <Clock3 size={14} /> 总耗时 {formatElapsedSeconds(timing.taskSeconds)}
            </span>
            <span>{formatDurationSummary(taskDurationSummary(activeTask))}</span>
          </div>
          {sourceSummary !== null && (
            <div className="task-monitor-source">
              <FolderTree size={15} />
              <span>{sourceSummary}</span>
            </div>
          )}
          <div className="task-overall-progress">
            <div>
              <span>整体进度</span>
              <strong>
                {Math.min(currentIndex, processingTotal)} / {processingTotal}
                {waitingCount > 0 ? ` · 另有 ${waitingCount} 项等待` : ''}
              </strong>
            </div>
            <div
              aria-label={`任务整体进度 ${activeTask.progress}%`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={activeTask.progress}
              className="task-overall-track"
              role="progressbar"
            >
              <span style={{ width: `${activeTask.progress}%` }} />
            </div>
            <strong>{activeTask.progress}%</strong>
          </div>
          <div className="task-current-progress">
            <div>
              <span>
                当前媒体
                {currentMedia ? ` · ${fileName(currentMedia.path)}` : ''}
              </span>
              <strong>
                {currentMedia?.progress === null || currentMedia?.progress === undefined
                  ? '—'
                  : `${Math.round(currentMedia.progress)}%`}
              </strong>
            </div>
            <div
              aria-label={
                currentMedia?.progress === null || currentMedia?.progress === undefined
                  ? '当前媒体进度未知'
                  : `当前媒体进度 ${Math.round(currentMedia.progress)}%`
              }
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={currentMedia?.progress ?? undefined}
              className={`task-overall-track is-media ${
                currentMedia?.progress === null || currentMedia?.progress === undefined
                  ? 'is-indeterminate'
                  : ''
              }`}
              role="progressbar"
            >
              {currentMedia?.progress !== null && currentMedia?.progress !== undefined && (
                <span
                  style={{
                    width: `${Math.max(0, Math.min(100, currentMedia.progress))}%`,
                  }}
                />
              )}
            </div>
            <small>
              已耗时 {formatElapsedSeconds(timing.mediaSeconds)} / 时长{' '}
              {formatMediaDuration(currentMedia?.durationSeconds)}
            </small>
          </div>
          <div className="task-monitor-output">
            <span>
              已生成 <strong>{outputPaths.length}</strong> 个输出文件
            </span>
            <button
              disabled={outputPaths.length === 0}
              onClick={() => void openTaskOutputDirectory(activeTask.id)}
              type="button"
            >
              <FolderOpen size={15} /> 打开输出目录
            </button>
          </div>
        </section>

        <section className="task-media-monitor" aria-labelledby="task-media-title">
          <header>
            <div>
              <p className="step-label">EXPANDED MEDIA</p>
              <h3 id="task-media-title">媒体文件进度</h3>
            </div>
            <span>{mediaStates.length} 个文件</span>
          </header>
          <div {...mediaFollowHandlers} className="task-media-list" tabIndex={0}>
            {mediaStates.map((media, index) => (
              <article
                className={`task-media-row is-${media.status}`}
                key={media.path}
                ref={media.path === currentMedia?.path ? mediaRowRef : undefined}
              >
                <span className="task-media-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="task-media-icon" aria-hidden="true">
                  {media.status === 'completed' ? <Check size={16} /> : <FileAudio size={16} />}
                </span>
                <div className="task-media-copy">
                  <strong title={media.path}>{fileName(media.path)}</strong>
                  <span title={media.path}>{media.path}</span>
                  <div
                    aria-label={
                      media.progress === null
                        ? `${fileName(media.path)} 进度未知`
                        : `${fileName(media.path)} 进度 ${Math.round(media.progress)}%`
                    }
                    className={`task-media-track ${media.progress === null ? 'is-indeterminate' : ''}`}
                  >
                    {media.progress !== null && (
                      <span style={{ width: `${Math.max(0, Math.min(100, media.progress))}%` }} />
                    )}
                  </div>
                </div>
                <div className="task-media-state">
                  <strong>
                    {media.progress === null ? '—' : `${Math.round(media.progress)}%`}
                  </strong>
                  <span>{mediaStatusLabel(media)}</span>
                  <small>
                    {formatElapsedSeconds(
                      media.path === currentMedia?.path
                        ? timing.mediaSeconds
                        : media.elapsedSeconds,
                    )}
                  </small>
                  <small>时长 {formatMediaDuration(media.durationSeconds)}</small>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="task-process-monitor" aria-labelledby="task-process-title">
          <header>
            <div>
              <p className="step-label">PROCESS</p>
              <h3 id="task-process-title">当前任务处理链路</h3>
            </div>
            <span>{activeTask.stage}</span>
          </header>
          <ol>
            {PROCESS_STEPS.map((step) => {
              const completed =
                activeTask.status === 'completed' ||
                activeTask.progress >= 100 ||
                activeTask.progress >= step.end;
              const active =
                !completed && activeTask.progress >= step.start && activeTask.progress < step.end;
              return (
                <li
                  className={completed ? 'is-complete' : active ? 'is-active' : ''}
                  key={step.label}
                >
                  <span>{completed ? <Check size={14} /> : <i />}</span>
                  <strong>{step.label}</strong>
                  <small>{completed ? '已完成' : active ? activeTask.stage : '等待'}</small>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
      <ConfirmDialog
        confirmLabel="终止任务"
        description="终止后会保留已经成功写入的输出，未完成媒体可从历史记录继续转录。"
        onCancel={() => setTerminationOpen(false)}
        onConfirm={() => {
          setTerminationOpen(false);
          void cancelTask(activeTask.id);
        }}
        open={terminationOpen}
        title="确认终止当前任务？"
      >
        <dl>
          <div>
            <dt>任务</dt>
            <dd>{activeTask.title}</dd>
          </div>
          <div>
            <dt>当前阶段</dt>
            <dd>{activeTask.stage}</dd>
          </div>
        </dl>
      </ConfirmDialog>
    </>
  );
}

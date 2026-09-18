import {
  Check,
  CircleDashed,
  FileAudio,
  FolderOpen,
  FolderTree,
  LoaderCircle,
  Radio,
  Square,
  Trash2,
} from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useCallback, useMemo, useRef, useState } from 'react';

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
import { formatTaskStage } from '../state/taskStage';
import { createInputTaskPreview, INPUT_TASK_PREVIEW_ID } from '../state/inputTaskPreview';
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

function parentDirectory(path: string): string {
  const parts = path.split(/[/\\]/);
  parts.pop();
  return parts.join('\\') || '本机媒体';
}

function monitorSourceSummary(task: TaskSnapshot): string | null {
  const inputs = task.draft?.inputs ?? [];
  if (inputs.length !== 1) return taskSourceSummary(task);
  return inputs[0]?.kind === 'file'
    ? `单个文件 · ${task.sourceCount} 个媒体文件`
    : `文件夹输入 · ${task.sourceCount} 个媒体文件`;
}

function mediaStatusLabel(media: TaskMediaSnapshot): string {
  if (media.status === 'completed') return '已完成';
  if (media.status === 'running') return formatTaskStage(media.stage);
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

export function resolveTaskMonitorTarget(
  tasks: TaskSnapshot[],
  monitoredTaskId: string | null,
  inputTaskPreview: TaskSnapshot | null,
): TaskSnapshot | undefined {
  return (
    inputTaskPreview ?? tasks.find((task) => task.id === monitoredTaskId) ?? activeTaskFrom(tasks)
  );
}

export function TaskMonitor() {
  const tasks = useWorkspace((state) => state.tasks);
  const inputs = useWorkspace((state) => state.inputs);
  const selectedPresetId = useWorkspace((state) => state.selectedPresetId);
  const selectedModelId = useWorkspace((state) => state.selectedModelId);
  const monitoredTaskId = useWorkspace((state) => state.monitoredTaskId);
  const cancelTask = useWorkspace((state) => state.cancelTask);
  const clearInputs = useWorkspace((state) => state.clearInputs);
  const openTaskOutputDirectory = useWorkspace((state) => state.openTaskOutputDirectory);
  const [terminationOpen, setTerminationOpen] = useState(false);
  const mediaRowRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const inputTaskPreview = useMemo(
    () => createInputTaskPreview(inputs, selectedPresetId, selectedModelId),
    [inputs, selectedModelId, selectedPresetId],
  );
  const activeTask = resolveTaskMonitorTarget(tasks, monitoredTaskId, inputTaskPreview);
  const isInputTaskPreview = activeTask?.id === INPUT_TASK_PREVIEW_ID;
  const waitingCount = tasks.filter(
    (task) =>
      task.status === 'queued' &&
      task.id !== activeTask?.id &&
      !isInputTaskPreview &&
      (activeTask?.status === 'running' || activeTask?.status === 'queued'),
  ).length;
  const fallbackMediaPaths =
    activeTask?.mediaPaths && activeTask.mediaPaths.length > 0
      ? activeTask.mediaPaths
      : (activeTask?.draft?.inputs.map((input) => input.path) ?? []);
  const fallbackCurrentIndex =
    activeTask?.currentMediaIndex ??
    (activeTask?.status === 'running' && activeTask.progress > 0 && fallbackMediaPaths.length > 0
      ? 1
      : 0);
  const mediaStates: TaskMediaSnapshot[] =
    activeTask?.mediaStates && activeTask.mediaStates.length > 0
      ? activeTask.mediaStates
      : fallbackMediaPaths.map((path, index) => {
          const position = index + 1;
          const completed = activeTask?.status === 'completed' || position < fallbackCurrentIndex;
          const running = activeTask?.status === 'running' && position === fallbackCurrentIndex;
          return {
            path,
            status: completed ? 'completed' : running ? 'running' : 'pending',
            progress: completed ? 100 : running ? null : 0,
            stage: completed ? '已完成' : running ? activeTask.stage : '等待处理',
            elapsedSeconds: 0,
          };
        });
  const runningMediaIndex = mediaStates.findIndex((media) => media.status === 'running');
  const currentIndex =
    activeTask?.status === 'running'
      ? (activeTask.currentMediaIndex ??
        (runningMediaIndex >= 0 ? runningMediaIndex + 1 : fallbackCurrentIndex))
      : activeTask?.status === 'completed'
        ? mediaStates.length
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
  const sourceSummary = isInputTaskPreview
    ? `已展开 ${mediaStates.length} 个待处理媒体文件`
    : monitorSourceSummary(activeTask);
  const completedMediaCount = mediaStates.filter(
    (media) => media.status === 'completed' || media.status === 'skipped',
  ).length;
  const processedMediaCount =
    activeTask.status === 'completed' || activeTask.progress >= 100
      ? processingTotal
      : Math.max(completedMediaCount, Math.min(currentIndex, processingTotal));
  const currentMediaPosition = currentMedia
    ? Math.max(1, mediaStates.findIndex((media) => media.path === currentMedia.path) + 1)
    : currentIndex;
  const durationSummary = formatDurationSummary(taskDurationSummary(activeTask)).replace(
    /^总时长\s*/,
    '',
  );
  const outputPaths = [
    ...new Set([
      ...(activeTask.outputs ?? []),
      ...mediaStates.flatMap((media) => media.outputPaths ?? []),
    ]),
  ];
  const isActive =
    !isInputTaskPreview && (activeTask.status === 'running' || activeTask.status === 'queued');
  const statusLabel = isInputTaskPreview
    ? '待开始'
    : activeTask.status === 'running'
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
            <div className="task-monitor-overline">
              <p className="step-label">
                {isInputTaskPreview ? 'INPUT SOURCE PREVIEW' : 'LIVE TASK MONITOR'}
              </p>
              <div className="task-monitor-heading-actions">
                {isInputTaskPreview && (
                  <button
                    className="task-monitor-clear"
                    onClick={clearInputs}
                    title="只清空当前输入清单，不删除本机媒体文件"
                    type="button"
                  >
                    <Trash2 size={14} /> 清除清单
                  </button>
                )}
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
            </div>
            <h2 id="task-monitor-title" title={activeTask.title}>
              {activeTask.title}
            </h2>
          </header>
          <div className="task-monitor-meta" aria-label="当前任务日期版本与模型">
            <span>
              <small>创建时间</small>
              <strong>{formatTaskCreatedAt(activeTask.createdAt)}</strong>
            </span>
            <span>
              <small>转录版本</small>
              <strong>{getPreset(activeTask.presetId).label}</strong>
            </span>
            <span>
              <small>推理模型</small>
              <strong>{getModelLabel(activeTask.modelId)}</strong>
            </span>
            <span>
              <small>媒体时长</small>
              <strong>{durationSummary}</strong>
            </span>
          </div>
          <div className="task-monitor-progress-grid">
            <section className="task-monitor-progress-card is-overall" aria-label="整体进度">
              <div className="task-monitor-progress-heading">
                <span>整体进度</span>
                <strong>{activeTask.progress}%</strong>
              </div>
              <div className="task-monitor-progress-copy">
                <strong>
                  {processedMediaCount} / {processingTotal}
                </strong>
                <span>已处理媒体</span>
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
              <footer>
                <span>{formatTaskStage(activeTask.stage)}</span>
                <span>
                  已耗时 {formatElapsedSeconds(timing.taskSeconds)}
                  {waitingCount > 0 ? ` · 另有 ${waitingCount} 项等待` : ''}
                </span>
              </footer>
            </section>

            <section className="task-monitor-progress-card is-current" aria-label="当前媒体进度">
              <div className="task-monitor-progress-heading">
                <span>{activeTask.status === 'completed' ? '最后处理媒体' : '当前媒体'}</span>
                <strong>
                  {currentMedia?.progress === null || currentMedia?.progress === undefined
                    ? '—'
                    : `${Math.round(currentMedia.progress)}%`}
                </strong>
              </div>
              <div className="task-monitor-progress-copy">
                <strong title={currentMedia?.path}>
                  {activeTask.status === 'queued'
                    ? '等待媒体处理'
                    : currentMedia
                      ? fileName(currentMedia.path)
                      : '尚未进入媒体处理'}
                </strong>
                <span>
                  {activeTask.status === 'queued'
                    ? `${processingTotal} 个媒体已就绪`
                    : currentMedia
                      ? `${mediaStatusLabel(currentMedia)} · 第 ${currentMediaPosition} / ${processingTotal} 个`
                      : '等待任务开始'}
                </span>
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
              <footer>
                <span>已耗时 {formatElapsedSeconds(timing.mediaSeconds)}</span>
                <span>时长 {formatMediaDuration(currentMedia?.durationSeconds)}</span>
              </footer>
            </section>
          </div>

          <div className="task-monitor-support-grid">
            {sourceSummary !== null && (
              <div className="task-monitor-source">
                <span aria-hidden="true">
                  <FolderTree size={16} />
                </span>
                <div>
                  <small>输入来源</small>
                  <strong>{sourceSummary}</strong>
                </div>
              </div>
            )}
            <div className="task-monitor-output">
              <span aria-hidden="true">
                <FolderOpen size={16} />
              </span>
              <div>
                <small>输出结果</small>
                <strong>已生成 {outputPaths.length} 个文件</strong>
              </div>
              <button
                disabled={outputPaths.length === 0}
                onClick={() => void openTaskOutputDirectory(activeTask.id)}
                type="button"
              >
                打开目录
              </button>
            </div>
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
                  <strong>{fileName(media.path)}</strong>
                  <span title={media.path}>{parentDirectory(media.path)}</span>
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
                    )}{' '}
                    / {formatMediaDuration(media.durationSeconds)}
                  </small>
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
            <span>{formatTaskStage(activeTask.stage)}</span>
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
                  <small>
                    {completed ? '完成' : active ? formatTaskStage(activeTask.stage) : '待执行'}
                  </small>
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
        title="确认终止当前任务"
      >
        <dl>
          <div>
            <dt>任务</dt>
            <dd>{activeTask.title}</dd>
          </div>
          <div>
            <dt>当前阶段</dt>
            <dd>{formatTaskStage(activeTask.stage)}</dd>
          </div>
        </dl>
      </ConfirmDialog>
    </>
  );
}

import {
  CircleDashed,
  FolderOpen,
  FolderTree,
  LoaderCircle,
  Radio,
  Square,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { TaskMediaList } from './TaskMediaList';
import { TaskProcessChain } from './TaskProcessChain';

import type { TaskSnapshot } from '../../contracts/desktop';
import { getModelLabel } from '../../data/models';
import { getPreset } from '../../data/presets';
import { createInputTaskPreview, INPUT_TASK_PREVIEW_ID } from '../../state/inputTaskPreview';
import {
  formatDurationSummary,
  formatMediaDuration,
  taskDurationSummary,
} from '../../state/mediaDuration';
import { formatTaskCreatedAt } from '../../state/taskHistory';
import {
  currentTaskMedia,
  monitorMediaStates,
  processedMediaCount,
  resolveTaskMonitorTarget,
} from '../../state/taskMonitor';
import { taskSourceSummary } from '../../state/taskSourceSummary';
import { formatTaskStage } from '../../state/taskStage';
import { useWorkspace } from '../../state/workspace';
import { taskOutputPaths } from '../../state/workspaceTaskState';
import { ConfirmDialog } from '../ConfirmDialog';
import { formatElapsedSeconds, useTaskTiming } from '../useTaskTiming';

function fileName(path: string): string {
  return path.split(/[/\\]/).at(-1) ?? path;
}

function monitorSourceSummary(task: TaskSnapshot): string | null {
  const inputs = task.draft?.inputs ?? [];
  if (inputs.length !== 1) return taskSourceSummary(task);
  return inputs[0]?.kind === 'file'
    ? `单个文件 · ${task.sourceCount} 个媒体文件`
    : `文件夹输入 · ${task.sourceCount} 个媒体文件`;
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
  const [terminationTask, setTerminationTask] = useState<TaskSnapshot | null>(null);
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
  const mediaStates = useMemo(() => monitorMediaStates(activeTask), [activeTask]);
  const currentMedia = currentTaskMedia(activeTask, mediaStates);
  const timing = useTaskTiming(activeTask, currentMedia);

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
    ? `已选择 ${inputs.length} 项输入，共 ${activeTask.sourceCount} 个媒体，提交后展开文件夹`
    : monitorSourceSummary(activeTask);
  const processedCount = processedMediaCount(mediaStates);
  const durationSummary = formatDurationSummary(taskDurationSummary(activeTask)).replace(
    /^总时长\s*/,
    '',
  );
  const outputPaths = taskOutputPaths(activeTask);
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
                <span className={`task-monitor-live ${activeTask.status}`}>
                  {activeTask.status === 'running' ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <CircleDashed size={15} />
                  )}
                  {statusLabel}
                </span>
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
                    onClick={() => setTerminationTask(activeTask)}
                    type="button"
                  >
                    <Square fill="currentColor" size={12} /> 终止任务
                  </button>
                )}
              </div>
            </div>
            <h2 id="task-monitor-title" title={activeTask.title}>
              {activeTask.title}
            </h2>
          </header>
          <div className="task-monitor-dashboard">
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
                    {processedCount} / {processingTotal}
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
                  {activeTask.status === 'queued' ? (
                    <span>{processingTotal} 个媒体已就绪</span>
                  ) : (
                    !currentMedia && <span>等待任务开始</span>
                  )}
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
          </div>
        </section>

        <TaskMediaList
          task={activeTask}
          mediaStates={mediaStates}
          currentMedia={currentMedia}
          mediaSeconds={timing.mediaSeconds}
          isInputTaskPreview={isInputTaskPreview}
        />
        <TaskProcessChain task={activeTask} />
      </div>
      <ConfirmDialog
        confirmLabel="终止任务"
        description="终止后会保留已经成功写入的输出，未完成媒体可从历史记录继续转录。"
        onCancel={() => setTerminationTask(null)}
        onConfirm={() => {
          if (terminationTask) void cancelTask(terminationTask.id);
          setTerminationTask(null);
        }}
        open={terminationTask !== null}
        title="确认终止当前任务"
      >
        <dl>
          <div>
            <dt>任务</dt>
            <dd>{terminationTask?.title}</dd>
          </div>
          <div>
            <dt>当前阶段</dt>
            <dd>{formatTaskStage(terminationTask?.stage ?? '')}</dd>
          </div>
        </dl>
      </ConfirmDialog>
    </>
  );
}

import {
  AlertCircle,
  CheckCircle2,
  CircleStop,
  Clock3,
  Eraser,
  FolderOpen,
  Eye,
  LoaderCircle,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { TaskSnapshot } from '../contracts/desktop';
import { getModelLabel } from '../data/models';
import { formatResolvedHardware } from '../state/hardware';
import { formatDurationSummary, taskDurationSummary } from '../state/mediaDuration';
import { getPreset, transcriptionTaskLabel } from '../data/presets';
import { canResumeTask, isAbnormalTask, useWorkspace } from '../state/workspace';
import {
  availableTaskDates,
  formatTaskCreatedAt,
  taskMatchesDateRange,
} from '../state/taskHistory';
import { ConfirmDialog } from './ConfirmDialog';
import { TaskDateFilter } from './TaskDateFilter';

const FILTER_LABELS = {
  all: '全部',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
} as const;

function StatusIcon({ task }: { task: TaskSnapshot }) {
  if (task.outputAvailability === 'missing') return <AlertCircle size={17} />;
  if (task.status === 'running') return <LoaderCircle className="spin" size={17} />;
  if (task.status === 'completed') return <CheckCircle2 size={17} />;
  if (task.status === 'cancelled') return <CircleStop size={17} />;
  if (task.status === 'failed') return <AlertCircle size={17} />;
  return <Clock3 size={17} />;
}

export function TaskList({ expanded = false }: { expanded?: boolean }) {
  const tasks = useWorkspace((state) => state.tasks);
  const cancelTask = useWorkspace((state) => state.cancelTask);
  const revealTaskOutput = useWorkspace((state) => state.revealTaskOutput);
  const selectTask = useWorkspace((state) => state.selectTask);
  const retryTask = useWorkspace((state) => state.retryTask);
  const resumeTask = useWorkspace((state) => state.resumeTask);
  const clearCompletedHistory = useWorkspace((state) => state.clearCompletedHistory);
  const clearAbnormalHistory = useWorkspace((state) => state.clearAbnormalHistory);
  const auditTaskOutputs = useWorkspace((state) => state.auditTaskOutputs);
  const outputAuditPending = useWorkspace((state) => state.outputAuditPending);
  const taskFilter = useWorkspace((state) => state.taskFilter);
  const setTaskFilter = useWorkspace((state) => state.setTaskFilter);
  const taskSearch = useWorkspace((state) => state.taskSearch);
  const setTaskSearch = useWorkspace((state) => state.setTaskSearch);
  const taskDateRange = useWorkspace((state) => state.taskDateRange);
  const setTaskDateRange = useWorkspace((state) => state.setTaskDateRange);
  const deleteTaskHistory = useWorkspace((state) => state.deleteTaskHistory);
  const startingTask = useWorkspace((state) => state.startingTask);
  const [retryTaskId, setRetryTaskId] = useState<string | null>(null);
  const [armedDelete, setArmedDelete] = useState<{ key: string; label: string } | null>(null);
  const visibleTasks = tasks
    .filter((task) => taskFilter === 'all' || task.status === taskFilter)
    .filter((task) => task.title.toLocaleLowerCase().includes(taskSearch.toLocaleLowerCase()))
    .filter((task) => taskMatchesDateRange(task, taskDateRange))
    .slice(0, expanded ? undefined : 4);
  const completedCount = tasks.filter(
    (task) => task.status === 'completed' && task.outputAvailability !== 'missing',
  ).length;
  const abnormalCount = tasks.filter(isAbnormalTask).length;
  const retryCandidate = tasks.find((task) => task.id === retryTaskId);
  const taskDates = availableTaskDates(tasks);

  const closeRetryConfirmation = useCallback(() => {
    if (!startingTask) setRetryTaskId(null);
  }, [startingTask]);

  const confirmRetry = useCallback(async () => {
    if (retryTaskId === null) return;
    await retryTask(retryTaskId);
    setRetryTaskId(null);
  }, [retryTask, retryTaskId]);

  const armOrDelete = useCallback(
    (key: string, label: string, action: () => void) => {
      if (armedDelete?.key === key) {
        setArmedDelete(null);
        action();
        return;
      }
      setArmedDelete({ key, label });
    },
    [armedDelete],
  );

  useEffect(() => {
    if (armedDelete === null) return;
    const timeout = window.setTimeout(() => setArmedDelete(null), 4000);
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setArmedDelete(null);
    };
    const cancelOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const owner = event.target.closest('[data-delete-arm-key]');
      if (owner?.getAttribute('data-delete-arm-key') !== armedDelete.key) {
        setArmedDelete(null);
      }
    };
    document.addEventListener('keydown', cancelOnEscape);
    document.addEventListener('pointerdown', cancelOutside, true);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener('keydown', cancelOnEscape);
      document.removeEventListener('pointerdown', cancelOutside, true);
    };
  }, [armedDelete]);

  useEffect(() => {
    if (expanded) void auditTaskOutputs();
  }, [auditTaskOutputs, expanded]);

  return (
    <section
      className={`panel task-panel ${expanded ? 'is-expanded' : ''}`}
      aria-labelledby="task-title"
    >
      <div className="panel-heading">
        <div>
          <p className="step-label">
            {expanded ? 'CONTROLLED LOCAL IPC' : 'LOCAL QUEUE / 本机队列'}
          </p>
          <h2 id="task-title">{expanded ? '本机任务历史' : '最近任务'}</h2>
        </div>
        <span className="task-count">{tasks.length} 项</span>
      </div>
      {expanded && (
        <div className="task-control-deck">
          <div className="task-toolbar">
            <input
              aria-label="搜索任务"
              id="task-history-search"
              onChange={(event) => setTaskSearch(event.target.value)}
              placeholder="按文件名搜索历史…"
              type="search"
              value={taskSearch}
            />
            <TaskDateFilter
              availableDates={taskDates}
              onChange={setTaskDateRange}
              range={taskDateRange}
            />
            <div className="filter-tabs" aria-label="任务状态筛选">
              {(['all', 'running', 'completed', 'failed', 'cancelled'] as const).map((filter) => (
                <button
                  aria-pressed={taskFilter === filter}
                  className={taskFilter === filter ? 'is-active' : ''}
                  key={filter}
                  onClick={() => setTaskFilter(filter)}
                  type="button"
                >
                  {FILTER_LABELS[filter]}
                </button>
              ))}
            </div>
          </div>
          <div className="task-history-tools" aria-label="任务历史维护">
            <span>只清理本机历史，不删除输出文件</span>
            <button
              aria-pressed={armedDelete?.key === 'clear-completed'}
              className={`secondary-button ${armedDelete?.key === 'clear-completed' ? 'is-delete-armed' : ''}`}
              data-delete-arm-key="clear-completed"
              disabled={outputAuditPending || completedCount === 0}
              onClick={() =>
                armOrDelete('clear-completed', '再次点击清除已完成历史', clearCompletedHistory)
              }
              type="button"
            >
              <Eraser size={15} />{' '}
              {armedDelete?.key === 'clear-completed'
                ? '再次点击清除'
                : `清除已完成历史 · ${completedCount}`}
            </button>
            <button
              aria-pressed={armedDelete?.key === 'clear-abnormal'}
              className={`secondary-button is-danger-subtle ${armedDelete?.key === 'clear-abnormal' ? 'is-delete-armed' : ''}`}
              data-delete-arm-key="clear-abnormal"
              disabled={outputAuditPending || abnormalCount === 0}
              onClick={() =>
                armOrDelete('clear-abnormal', '再次点击清除异常历史', clearAbnormalHistory)
              }
              type="button"
            >
              <AlertCircle size={15} />{' '}
              {armedDelete?.key === 'clear-abnormal'
                ? '再次点击清除'
                : `清除异常历史 · ${abnormalCount}`}
            </button>
          </div>
        </div>
      )}
      <span aria-live="polite" className="sr-only">
        {armedDelete?.label ?? ''}
      </span>
      <div className="task-list">
        {visibleTasks.length === 0 && <div className="empty-tasks">没有符合条件的任务。</div>}
        {visibleTasks.map((task) => {
          const resumable = canResumeTask(task);
          return (
            <article className="task-row" key={task.id}>
              <div
                className={`task-status ${task.outputAvailability === 'missing' ? 'failed' : task.status}`}
              >
                <StatusIcon task={task} />
              </div>
              <button
                aria-label={`查看 ${task.title} 详情`}
                className="task-main task-open"
                onClick={() => void selectTask(task.id)}
                type="button"
              >
                <div className="task-title-line">
                  <strong>{task.title}</strong>
                  {task.isCustom && <em>自定义</em>}
                </div>
                <div className="task-meta">
                  <span>
                    {task.outputAvailability === 'missing' ? '输出文件已丢失或移动' : task.stage}
                  </span>
                  <span>·</span>
                  <span>{task.elapsed}</span>
                  <span>·</span>
                  <span>{task.sourceCount} 个媒体文件</span>
                  <span>·</span>
                  <span>{formatDurationSummary(taskDurationSummary(task))}</span>
                  <span>·</span>
                  <span>{getModelLabel(task.modelId)}</span>
                  <span>·</span>
                  <span>{formatTaskCreatedAt(task.createdAt)}</span>
                </div>
                <div className="progress-track" aria-label={`任务进度 ${task.progress}%`}>
                  <span style={{ width: `${task.progress}%` }} />
                </div>
              </button>
              <div className="task-card-footer">
                <span className="task-version">
                  {getPreset(task.presetId).label} ·{' '}
                  {recognitionStrategyLabel(task.recognitionStrategy)}
                </span>
                <div className="task-card-footer-actions">
                  <strong className="task-percent">{task.progress}%</strong>
                  {task.status === 'running' || task.status === 'queued' ? (
                    <button
                      aria-label={`取消 ${task.title}`}
                      className="icon-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void cancelTask(task.id);
                      }}
                      type="button"
                    >
                      <CircleStop size={17} />
                    </button>
                  ) : (
                    <div className="task-actions">
                      <button
                        aria-label={`${armedDelete?.key === `task:${task.id}` ? '再次点击删除' : '删除'} ${task.title} 的任务记录`}
                        aria-pressed={armedDelete?.key === `task:${task.id}`}
                        className={`icon-button has-tooltip is-danger-action ${armedDelete?.key === `task:${task.id}` ? 'is-delete-armed' : ''}`}
                        data-delete-arm-key={`task:${task.id}`}
                        data-tooltip={
                          armedDelete?.key === `task:${task.id}` ? '再次点击删除' : '删除任务记录'
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          armOrDelete(
                            `task:${task.id}`,
                            `再次点击删除 ${task.title} 的任务记录`,
                            () => deleteTaskHistory(task.id),
                          );
                        }}
                        type="button"
                      >
                        <Trash2 size={17} />
                      </button>
                      {task.draft && (
                        <button
                          aria-label={`${resumable ? '继续转录' : '重新转录'} ${task.title}`}
                          className="icon-button has-tooltip"
                          data-tooltip={resumable ? '继续转录' : '重新转录'}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (resumable) {
                              void resumeTask(task.id);
                            } else {
                              setRetryTaskId(task.id);
                            }
                          }}
                          type="button"
                        >
                          <RotateCcw size={17} />
                        </button>
                      )}
                      {task.status === 'completed' &&
                        task.outputAvailability !== 'missing' &&
                        (task.outputs?.length ?? 0) > 0 && (
                          <button
                            aria-label={`在资源管理器中定位 ${task.title} 的输出`}
                            className="icon-button has-tooltip"
                            data-tooltip="定位输出"
                            onClick={(event) => {
                              event.stopPropagation();
                              void revealTaskOutput(task.id);
                            }}
                            type="button"
                          >
                            <FolderOpen size={18} />
                          </button>
                        )}
                      <button
                        aria-label={`查看 ${task.title} 详情`}
                        className="icon-button has-tooltip"
                        data-tooltip="查看任务详情"
                        onClick={(event) => {
                          event.stopPropagation();
                          void selectTask(task.id);
                        }}
                        type="button"
                      >
                        <Eye size={18} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <ConfirmDialog
        confirmLabel="载入原配置"
        description="软件只会把历史输入、参数、模型、硬件和输出策略载入转录工作台，不会立即创建或执行任务。"
        onCancel={closeRetryConfirmation}
        onConfirm={() => void confirmRetry()}
        open={retryCandidate !== undefined}
        pending={startingTask}
        title="载入历史转录配置？"
      >
        {retryCandidate && (
          <dl>
            <div>
              <dt>任务</dt>
              <dd>{retryCandidate.title}</dd>
            </div>
            <div>
              <dt>转录版本</dt>
              <dd>{getPreset(retryCandidate.presetId).label}</dd>
            </div>
            <div>
              <dt>识别策略</dt>
              <dd>{recognitionStrategyLabel(retryCandidate.recognitionStrategy)}</dd>
            </div>
            <div>
              <dt>任务类型</dt>
              <dd>{transcriptionTaskLabel(retryCandidate.draft?.effectiveParameters.task)}</dd>
            </div>
            <div>
              <dt>推理模型</dt>
              <dd>{getModelLabel(retryCandidate.modelId)}</dd>
            </div>
            <div>
              <dt>硬件配置</dt>
              <dd>{formatResolvedHardware(retryCandidate.hardware)}</dd>
            </div>
            <div>
              <dt>媒体数量</dt>
              <dd>{retryCandidate.sourceCount} 个</dd>
            </div>
            <div>
              <dt>输出策略</dt>
              <dd>{retryCandidate.draft?.output.mode === 'custom' ? '自定义目录' : '跟随媒体'}</dd>
            </div>
          </dl>
        )}
      </ConfirmDialog>
    </section>
  );
}

function recognitionStrategyLabel(
  strategy: import('../contracts/desktop').RecognitionStrategy | undefined,
): string {
  if (strategy === 'mixed_zh_en') return '复杂中英混合';
  if (strategy === 'zh_detail_review') return '中文细节增强';
  return '稳定主语言';
}

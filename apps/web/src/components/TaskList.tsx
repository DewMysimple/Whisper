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
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { TaskSnapshot } from '../contracts/desktop';
import { getModelLabel } from '../data/models';
import { formatMediaDuration, taskDurationSummary } from '../state/mediaDuration';
import { getPreset, transcriptionTaskLabel } from '../data/presets';
import { canResumeTask, isAbnormalTask, useWorkspace, type TaskFilter } from '../state/workspace';
import {
  availableTaskDates,
  formatTaskCreatedAt,
  taskMatchesDateRange,
} from '../state/taskHistory';
import { formatTaskStage } from '../state/taskStage';
import { ConfirmDialog } from './ConfirmDialog';
import { TaskDateFilter } from './TaskDateFilter';

function StatusIcon({ task }: { task: TaskSnapshot }) {
  if (task.outputAvailability === 'missing') return <AlertCircle size={17} />;
  if (task.status === 'running') return <LoaderCircle className="spin" size={17} />;
  if (task.status === 'completed') return <CheckCircle2 size={17} />;
  if (task.status === 'cancelled') return <CircleStop size={17} />;
  if (task.status === 'failed') return <AlertCircle size={17} />;
  return <Clock3 size={17} />;
}

function taskStatusLabel(task: TaskSnapshot): string {
  if (task.outputAvailability === 'missing') return '输出缺失';
  if (task.status === 'running') return '运行中';
  if (task.status === 'completed') return '已完成';
  if (task.status === 'cancelled') return '已取消';
  if (task.status === 'failed') return '失败';
  return '等待中';
}

function taskStatusTone(task: TaskSnapshot): string {
  return task.outputAvailability === 'missing' ? 'failed' : task.status;
}

function taskMatchesFilter(task: TaskSnapshot, filter: TaskFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return task.status === 'queued' || task.status === 'running';
  if (filter === 'completed') {
    return task.status === 'completed' && task.outputAvailability !== 'missing';
  }
  return task.status === 'failed';
}

function taskOutputFormats(task: TaskSnapshot): string[] {
  const formats: string[] = [];
  const output = task.draft?.output;
  if (output?.txtEnabled) formats.push('TXT');
  if (output?.markdownEnabled) formats.push('MD');
  if (output?.srtEnabled) formats.push('SRT');

  if (formats.length === 0) {
    for (const path of task.outputs ?? []) {
      const extension = path.split('.').at(-1)?.toLocaleLowerCase();
      const label = extension === 'markdown' ? 'MD' : extension?.toLocaleUpperCase();
      if (label && ['TXT', 'MD', 'SRT'].includes(label) && !formats.includes(label)) {
        formats.push(label);
      }
    }
  }

  return formats.length > 0 ? formats : ['格式未记录'];
}

function taskTitleParts(title: string): { basename: string; extension: string } | null {
  const extensionStart = title.lastIndexOf('.');
  if (extensionStart <= 0 || extensionStart === title.length - 1) return null;

  return {
    basename: title.slice(0, extensionStart),
    extension: title.slice(extensionStart),
  };
}

function taskDurationValue(task: TaskSnapshot): string {
  const summary = taskDurationSummary(task);
  if (summary.unknownCount > 0) {
    if (summary.knownSeconds > 0) {
      return `${formatMediaDuration(summary.knownSeconds)} + ${summary.unknownCount} 未知`;
    }
    return summary.unknownCount >= task.sourceCount ? '未知' : `${summary.unknownCount} 个未知`;
  }
  return formatMediaDuration(summary.knownSeconds);
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
    .filter((task) => taskMatchesFilter(task, taskFilter))
    .filter((task) => task.title.toLocaleLowerCase().includes(taskSearch.toLocaleLowerCase()))
    .filter((task) => taskMatchesDateRange(task, taskDateRange))
    .slice(0, expanded ? undefined : 4);
  const completedCount = tasks.filter(
    (task) => task.status === 'completed' && task.outputAvailability !== 'missing',
  ).length;
  const activeCount = tasks.filter(
    (task) => task.status === 'queued' || task.status === 'running',
  ).length;
  const attentionCount = tasks.filter((task) => task.status === 'failed').length;
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
      <div className={expanded ? 'task-history-manager' : undefined}>
        <div className={expanded ? 'task-history-manager-main' : undefined}>
          <div className="panel-heading">
            <div>
              <p className="step-label">
                {expanded ? 'LOCAL TASK ARCHIVE' : 'LOCAL QUEUE / 本机队列'}
              </p>
              <h2 id="task-title">{expanded ? '本机任务历史' : '最近任务'}</h2>
            </div>
            {!expanded && <span className="task-count">{tasks.length} 项</span>}
          </div>
          {expanded && (
            <div className="task-control-deck">
              <div className="task-toolbar">
                <div className="task-search-field">
                  <Search aria-hidden="true" size={16} />
                  <input
                    aria-label="搜索任务"
                    id="task-history-search"
                    onChange={(event) => setTaskSearch(event.target.value)}
                    placeholder="搜索文件名或任务名称…"
                    type="search"
                    value={taskSearch}
                  />
                  {taskSearch && (
                    <button
                      aria-label="清除任务搜索"
                      onClick={() => setTaskSearch('')}
                      type="button"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <TaskDateFilter
                  availableDates={taskDates}
                  onChange={setTaskDateRange}
                  range={taskDateRange}
                />
                <button
                  aria-label={
                    armedDelete?.key === 'clear-completed'
                      ? '再次点击清除历史；只移除本机记录，不删除输出文件'
                      : `清除历史 · ${completedCount}；只移除本机记录，不删除输出文件`
                  }
                  aria-pressed={armedDelete?.key === 'clear-completed'}
                  className={`secondary-button task-history-clear ${armedDelete?.key === 'clear-completed' ? 'is-delete-armed' : ''}`}
                  data-delete-arm-key="clear-completed"
                  disabled={outputAuditPending || completedCount === 0}
                  onClick={() =>
                    armOrDelete('clear-completed', '再次点击清除历史', clearCompletedHistory)
                  }
                  title="只移除本机已完成记录，不删除输出文件"
                  type="button"
                >
                  <Eraser size={15} />{' '}
                  {armedDelete?.key === 'clear-completed'
                    ? '再次点击清除'
                    : `清除历史 · ${completedCount}`}
                </button>
                <button
                  aria-label={
                    armedDelete?.key === 'clear-abnormal'
                      ? '再次点击清除异常；只移除本机记录，不删除输出文件'
                      : `清除异常 · ${abnormalCount}；只移除本机记录，不删除输出文件`
                  }
                  aria-pressed={armedDelete?.key === 'clear-abnormal'}
                  className={`secondary-button task-history-clear is-danger-subtle ${armedDelete?.key === 'clear-abnormal' ? 'is-delete-armed' : ''}`}
                  data-delete-arm-key="clear-abnormal"
                  disabled={outputAuditPending || abnormalCount === 0}
                  onClick={() =>
                    armOrDelete('clear-abnormal', '再次点击清除异常', clearAbnormalHistory)
                  }
                  title="移除失败、取消或输出缺失的本机记录"
                  type="button"
                >
                  <AlertCircle size={15} />{' '}
                  {armedDelete?.key === 'clear-abnormal'
                    ? '再次点击清除'
                    : `清除异常 · ${abnormalCount}`}
                </button>
              </div>
            </div>
          )}
        </div>
        {expanded && (
          <div className="task-summary task-summary-band" aria-label="历史任务筛选">
            <button
              aria-pressed={taskFilter === 'all'}
              className={`task-summary-card ${taskFilter === 'all' ? 'is-active' : ''}`}
              onClick={() => setTaskFilter('all')}
              type="button"
            >
              <small>全部任务</small>
              <strong>{tasks.length}</strong>
              <span>本机历史快照</span>
            </button>
            <button
              aria-pressed={taskFilter === 'active'}
              className={`task-summary-card ${taskFilter === 'active' ? 'is-active' : ''}`}
              onClick={() => setTaskFilter('active')}
              type="button"
            >
              <small>正在运行</small>
              <strong>{activeCount}</strong>
              <span>排队或转录中</span>
            </button>
            <button
              aria-pressed={taskFilter === 'completed'}
              className={`task-summary-card ${taskFilter === 'completed' ? 'is-active' : ''}`}
              onClick={() => setTaskFilter('completed')}
              type="button"
            >
              <small>已完成</small>
              <strong>{completedCount}</strong>
              <span>本机输出已生成</span>
            </button>
            <button
              aria-pressed={taskFilter === 'failed'}
              className={`task-summary-card ${taskFilter === 'failed' ? 'is-active' : ''}`}
              onClick={() => setTaskFilter('failed')}
              type="button"
            >
              <small>需要处理</small>
              <strong>{attentionCount}</strong>
              <span>转录失败任务</span>
            </button>
          </div>
        )}
      </div>
      <span aria-live="polite" className="sr-only">
        {armedDelete?.label ?? ''}
      </span>
      <section
        aria-label={expanded ? '任务归档区' : undefined}
        className={`task-history-archive ${expanded ? '' : 'is-compact'}`}
      >
        {expanded && (
          <header className="task-history-archive-heading">
            <div>
              <p className="step-label">ARCHIVED TASKS</p>
              <h3>任务记录</h3>
            </div>
          </header>
        )}
        <div className="task-list">
          {visibleTasks.length === 0 && <div className="empty-tasks">没有符合条件的任务。</div>}
          {visibleTasks.map((task) => {
            const resumable = canResumeTask(task);
            const outputFormats = taskOutputFormats(task);
            const titleParts = taskTitleParts(task.title);
            return (
              <article className={`task-row is-${taskStatusTone(task)}`} key={task.id}>
                <button
                  aria-label={`查看 ${task.title} 详情`}
                  className="task-main task-open"
                  onClick={() => void selectTask(task.id)}
                  type="button"
                >
                  <div className="task-card-heading">
                    <span
                      aria-label={taskStatusLabel(task)}
                      className={`task-status ${taskStatusTone(task)}`}
                      role="img"
                      title={taskStatusLabel(task)}
                    >
                      <StatusIcon task={task} />
                    </span>
                    <span className="task-card-identity">
                      <span className="task-title-line">
                        <strong
                          className={titleParts ? 'preserve-extension' : undefined}
                          title={task.title}
                        >
                          {titleParts ? (
                            <>
                              <span className="task-title-basename">{titleParts.basename}</span>
                              <span className="task-title-extension">{titleParts.extension}</span>
                            </>
                          ) : (
                            task.title
                          )}
                        </strong>
                      </span>
                      <span className="task-card-subline">
                        <time dateTime={task.createdAt}>{formatTaskCreatedAt(task.createdAt)}</time>
                      </span>
                    </span>
                    {expanded && (
                      <span
                        className="task-card-progress"
                        aria-label={`任务进度 ${task.progress}%`}
                      >
                        <strong aria-hidden="true">{task.progress}%</strong>
                      </span>
                    )}
                  </div>
                  {expanded ? (
                    <dl className="task-history-facts">
                      <div className="task-history-config-line">
                        <dt className="sr-only">转录模式、文本格式与参数配置</dt>
                        <dd>
                          <span className="task-history-config-cell">
                            <small>转录模式</small>
                            <strong title={getPreset(task.presetId).label}>
                              {getPreset(task.presetId).label}
                            </strong>
                          </span>
                          <span className="task-history-config-cell is-formats">
                            <small>文本格式</small>
                            <span className="task-card-format-list" aria-label="文本格式">
                              {outputFormats.map((format) => (
                                <span className="task-card-format" key={format}>
                                  {format}
                                </span>
                              ))}
                            </span>
                          </span>
                          <span className="task-history-config-cell is-parameters">
                            <small>参数配置</small>
                            <strong title={task.isCustom ? '自定义参数' : '默认参数'}>
                              {task.isCustom ? '自定义参数' : '默认参数'}
                            </strong>
                          </span>
                        </dd>
                      </div>
                      <div className="task-history-stat-line">
                        <dt className="sr-only">媒体、耗时与媒体时长</dt>
                        <dd>
                          <span>
                            <small>媒体</small>
                            <strong>{task.sourceCount} 个</strong>
                          </span>
                          <span>
                            <small>耗时</small>
                            <strong>{task.elapsed}</strong>
                          </span>
                          <span>
                            <small>媒体时长</small>
                            <strong>{taskDurationValue(task)}</strong>
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt>模型</dt>
                        <dd>{getModelLabel(task.modelId)}</dd>
                      </div>
                    </dl>
                  ) : (
                    <>
                      <div className="task-meta">
                        <span className="task-stage">
                          {task.outputAvailability === 'missing'
                            ? '输出文件已丢失或移动'
                            : formatTaskStage(task.stage)}
                        </span>
                        <span>耗时 {task.elapsed}</span>
                        <span>{task.sourceCount} 个媒体</span>
                        <span>{getModelLabel(task.modelId)}</span>
                      </div>
                      <div className="progress-track" aria-label={`任务进度 ${task.progress}%`}>
                        <span style={{ width: `${task.progress}%` }} />
                      </div>
                    </>
                  )}
                </button>
                <div className="task-card-footer">
                  {!expanded && (
                    <span className="task-version">{getPreset(task.presetId).label}</span>
                  )}
                  <div className="task-card-footer-actions">
                    {!expanded && <strong className="task-percent">{task.progress}%</strong>}
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
                          className={`icon-button is-danger-action ${armedDelete?.key === `task:${task.id}` ? 'is-delete-armed' : ''}`}
                          data-delete-arm-key={`task:${task.id}`}
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
                            className="icon-button"
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
                              className="icon-button"
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
                          className="icon-button"
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
      </section>
      <ConfirmDialog
        confirmLabel="载入原配置"
        description="软件只会把历史输入、参数、模型和输出策略载入转录工作台，不会立即创建或执行任务。"
        onCancel={closeRetryConfirmation}
        onConfirm={() => void confirmRetry()}
        open={retryCandidate !== undefined}
        pending={startingTask}
        title="载入历史转录配置"
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
              <dt>任务类型</dt>
              <dd>{transcriptionTaskLabel(retryCandidate.draft?.effectiveParameters.task)}</dd>
            </div>
            <div>
              <dt>推理模型</dt>
              <dd>{getModelLabel(retryCandidate.modelId)}</dd>
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

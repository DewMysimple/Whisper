import {
  AlertCircle,
  CheckCircle2,
  CircleStop,
  Clock3,
  Eye,
  FolderOpen,
  LoaderCircle,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { CardButton } from '../CardButton';
import { memo } from 'react';
import type { TaskSnapshot } from '../../contracts/desktop';
import { getModelLabel } from '../../data/models';
import { getPreset } from '../../data/presets';
import {
  formatTaskCreatedAt,
  taskDurationValue,
  taskOutputFormats,
  taskStatusLabel,
  taskStatusTone,
  taskTitleParts,
} from '../../state/taskHistory';
import { isCustomTaskDraft } from '../../state/workspaceDraft';
import { canResumeTask, taskOutputPaths } from '../../state/workspaceTaskState';
function StatusIcon({ task }: { task: TaskSnapshot }) {
  if (task.outputAvailability === 'missing') return <AlertCircle size={17} />;
  if (task.status === 'running') return <LoaderCircle className="spin" size={17} />;
  if (task.status === 'completed') return <CheckCircle2 size={17} />;
  if (task.status === 'cancelled') return <CircleStop size={17} />;
  if (task.status === 'failed') return <AlertCircle size={17} />;
  return <Clock3 size={17} />;
}
interface TaskHistoryCardProps {
  task: TaskSnapshot;
  deleteArmed: boolean;
  onInspect(id: string): void;
  onCancel(id: string): void;
  onReveal(id: string): void;
  onDelete(task: TaskSnapshot): void;
  onRestore(task: TaskSnapshot): void;
}
export const TaskHistoryCard = memo(function TaskHistoryCard({
  task,
  deleteArmed,
  onInspect,
  onCancel,
  onReveal,
  onDelete,
  onRestore,
}: TaskHistoryCardProps) {
  const isCustom = task.draft ? isCustomTaskDraft(task.draft) : task.isCustom;
  const resumable = canResumeTask(task);
  const outputFormats = taskOutputFormats(task);
  const titleParts = taskTitleParts(task.title);
  return (
    <article className={`task-row is-${taskStatusTone(task)}`}>
      <CardButton
        aria-label={`查看 ${task.title} 详情`}
        className="task-main"
        onClick={() => onInspect(task.id)}
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
              <strong className={titleParts ? 'preserve-extension' : undefined} title={task.title}>
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
        </div>
        <div className="task-card-progress-line">
          <span>{taskStatusLabel(task)}</span>
          <span className="task-card-progress" aria-label={`任务进度 ${task.progress}%`}>
            <strong aria-hidden="true">{task.progress}%</strong>
          </span>
          <span className="task-card-track" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }} />
          </span>
        </div>
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
              <span className="task-history-config-cell">
                <small>文本格式</small>
                <strong>{outputFormats.join(' ')}</strong>
              </span>
              <span className="task-history-config-cell">
                <small>参数配置</small>
                <strong title={isCustom ? '自定义参数' : '默认参数'}>
                  {isCustom ? '自定义参数' : '默认参数'}
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
        </dl>
      </CardButton>
      <div className="task-card-footer">
        <div className="task-card-model">
          <small>模型</small>
          <strong title={getModelLabel(task.modelId)}>{getModelLabel(task.modelId)}</strong>
        </div>
        <div className="task-card-footer-actions">
          {task.status === 'running' || task.status === 'queued' ? (
            <button
              aria-label={`取消 ${task.title}`}
              className="icon-button"
              onClick={(event) => {
                event.stopPropagation();
                onCancel(task.id);
              }}
              type="button"
            >
              <CircleStop size={17} />
            </button>
          ) : (
            <div className="task-actions">
              <button
                aria-label={`${deleteArmed ? '再次点击删除' : '删除'} ${task.title} 的任务记录`}
                aria-pressed={deleteArmed}
                className={`icon-button is-danger-action ${deleteArmed ? 'is-delete-armed' : ''}`}
                data-confirm-action={`task:${task.id}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(task);
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
                    onRestore(task);
                  }}
                  type="button"
                >
                  <RotateCcw size={17} />
                </button>
              )}
              {task.status === 'completed' &&
                task.outputAvailability !== 'missing' &&
                taskOutputPaths(task).length > 0 && (
                  <button
                    aria-label={`在资源管理器中定位 ${task.title} 的输出`}
                    className="icon-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onReveal(task.id);
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
                  onInspect(task.id);
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
});

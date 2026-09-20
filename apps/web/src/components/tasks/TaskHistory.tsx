import { AlertCircle, Eraser, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TaskSnapshot } from '../../contracts/desktop';
import {
  availableTaskDates,
  taskMatchesDateRange,
  taskMatchesFilter,
  taskHistoryCounts,
} from '../../state/taskHistory';
import { canResumeTask, isAbnormalTask, useWorkspace } from '../../state/workspace';
import { useTimedConfirmation } from '../useTimedConfirmation';
import { SegmentedCard } from '../SegmentedCard';
import { TaskDateFilter } from './TaskDateFilter';
import { TaskHistoryCard } from './TaskHistoryCard';
import { TaskRestoreDialog } from './TaskRestoreDialog';
export function TaskHistory({ navigation }: { navigation?: ReactNode }) {
  const tasks = useWorkspace((state) => state.tasks);
  const cancelTask = useWorkspace((state) => state.cancelTask);
  const revealTaskOutput = useWorkspace((state) => state.revealTaskOutput);
  const selectTask = useWorkspace((state) => state.selectTask);
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
  const [restoreTask, setRestoreTask] = useState<TaskSnapshot | null>(null);
  const [armedDelete, setArmedDelete] = useTimedConfirmation<{
    key: string;
    label: string;
  }>();
  const visibleTasks = useMemo(
    () =>
      tasks
        .filter((task) => taskMatchesFilter(task, taskFilter))
        .filter((task) => task.title.toLocaleLowerCase().includes(taskSearch.toLocaleLowerCase()))
        .filter((task) => taskMatchesDateRange(task, taskDateRange)),
    [tasks, taskFilter, taskSearch, taskDateRange],
  );
  const {
    completed: completedCount,
    active: activeCount,
    failed: attentionCount,
  } = taskHistoryCounts(tasks);
  const abnormalCount = tasks.filter(isAbnormalTask).length;
  const taskDates = availableTaskDates(tasks);
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
  const deleteRecord = useCallback(
    (task: TaskSnapshot) =>
      armOrDelete(`task:${task.id}`, `再次点击删除 ${task.title} 的任务记录`, () =>
        deleteTaskHistory(task.id),
      ),
    [armOrDelete, deleteTaskHistory],
  );
  const restoreRecord = useCallback(
    (task: TaskSnapshot) => {
      if (canResumeTask(task)) void resumeTask(task.id);
      else setRestoreTask(task);
    },
    [resumeTask],
  );
  useEffect(() => {
    void auditTaskOutputs();
  }, [auditTaskOutputs]);
  return (
    <section className="task-panel" aria-labelledby="task-title">
      <div className="task-history-manager">
        {navigation}
        <div className="task-history-manager-main">
          <div className="task-history-heading">
            <div>
              <p className="step-label">LOCAL TASK ARCHIVE</p>
              <h2 id="task-title">本机任务历史</h2>
            </div>
          </div>
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
                  <button aria-label="清除任务搜索" onClick={() => setTaskSearch('')} type="button">
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
                className={`task-history-clear ${armedDelete?.key === 'clear-completed' ? 'is-delete-armed' : ''}`}
                data-confirm-action="clear-completed"
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
                className={`task-history-clear is-danger-subtle ${armedDelete?.key === 'clear-abnormal' ? 'is-delete-armed' : ''}`}
                data-confirm-action="clear-abnormal"
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
        </div>
        <div className="task-summary task-summary-band" aria-label="历史任务筛选">
          {(
            [
              ['all', '全部任务', tasks.length, '本机历史快照'],
              ['active', '正在运行', activeCount, '排队或转录中'],
              ['completed', '已完成', completedCount, '本机输出已生成'],
              ['failed', '需要处理', attentionCount, '转录失败任务'],
            ] as const
          ).map(([filter, label, count, description]) => (
            <SegmentedCard
              key={filter}
              className="task-summary-card"
              filter={filter}
              label={label}
              value={count}
              description={description}
              selected={taskFilter === filter}
              onClick={() => setTaskFilter(filter)}
            />
          ))}
        </div>
      </div>
      <span aria-live="polite" className="sr-only">
        {armedDelete?.label ?? ''}
      </span>
      <section aria-label="任务归档区" className="task-history-archive">
        <header className="task-history-archive-heading">
          <div>
            <p className="step-label">ARCHIVED TASKS</p>
            <h3>任务记录</h3>
          </div>
        </header>
        <div className="task-list">
          {visibleTasks.length === 0 && <div className="empty-tasks">没有符合条件的任务。</div>}
          {visibleTasks.map((task) => (
            <TaskHistoryCard
              key={task.id}
              task={task}
              deleteArmed={armedDelete?.key === `task:${task.id}`}
              onInspect={selectTask}
              onCancel={cancelTask}
              onReveal={revealTaskOutput}
              onDelete={deleteRecord}
              onRestore={restoreRecord}
            />
          ))}
        </div>
      </section>
      <TaskRestoreDialog task={restoreTask} onClose={() => setRestoreTask(null)} />
    </section>
  );
}

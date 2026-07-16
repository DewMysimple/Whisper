import {
  AlertCircle,
  CheckCircle2,
  CircleStop,
  Clock3,
  FolderOpen,
  Eye,
  LoaderCircle,
  RotateCcw,
} from 'lucide-react';

import type { TaskSnapshot } from '../contracts/desktop';
import { getPreset } from '../data/presets';
import { useWorkspace } from '../state/workspace';

function StatusIcon({ task }: { task: TaskSnapshot }) {
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
  const taskFilter = useWorkspace((state) => state.taskFilter);
  const setTaskFilter = useWorkspace((state) => state.setTaskFilter);
  const taskSearch = useWorkspace((state) => state.taskSearch);
  const setTaskSearch = useWorkspace((state) => state.setTaskSearch);
  const visibleTasks = tasks
    .filter((task) => taskFilter === 'all' || task.status === taskFilter)
    .filter((task) => task.title.toLocaleLowerCase().includes(taskSearch.toLocaleLowerCase()))
    .slice(0, expanded ? undefined : 4);

  return (
    <section
      className={`panel task-panel ${expanded ? 'is-expanded' : ''}`}
      aria-labelledby="task-title"
    >
      <div className="panel-heading">
        <div>
          <p className="step-label">LIVE QUEUE</p>
          <h2 id="task-title">{expanded ? '全部任务' : '最近任务'}</h2>
        </div>
        <span className="task-count">{tasks.length} 项</span>
      </div>
      {expanded && (
        <div className="task-toolbar">
          <input
            aria-label="搜索任务"
            onChange={(event) => setTaskSearch(event.target.value)}
            placeholder="按文件名搜索历史…"
            type="search"
            value={taskSearch}
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
                {filter === 'all' ? '全部' : filter}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="task-list">
        {visibleTasks.length === 0 && <div className="empty-tasks">没有符合条件的任务。</div>}
        {visibleTasks.map((task) => (
          <article className="task-row" key={task.id}>
            <div className={`task-status ${task.status}`}>
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
                <span>{getPreset(task.presetId).label}</span>
                {task.isCustom && <em>自定义</em>}
              </div>
              <div className="task-meta">
                <span>{task.stage}</span>
                <span>·</span>
                <span>{task.elapsed}</span>
                <span>·</span>
                <span>{task.createdAt}</span>
              </div>
              <div className="progress-track" aria-label={`任务进度 ${task.progress}%`}>
                <span style={{ width: `${task.progress}%` }} />
              </div>
            </button>
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
                {task.draft && (
                  <button
                    aria-label={`重试 ${task.title}`}
                    className="icon-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void retryTask(task.id);
                    }}
                    type="button"
                  >
                    <RotateCcw size={17} />
                  </button>
                )}
                {task.status === 'completed' && (task.outputs?.length ?? 0) > 0 && (
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
          </article>
        ))}
      </div>
    </section>
  );
}

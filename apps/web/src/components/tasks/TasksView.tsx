import { Activity, History } from 'lucide-react';
import { useWorkspace } from '../../state/workspace';
import { TaskHistory } from './TaskHistory';
import { TaskMonitor } from './TaskMonitor';

export function TasksView() {
  const tasks = useWorkspace((state) => state.tasks);
  const inputs = useWorkspace((state) => state.inputs);
  const mode = useWorkspace((state) => state.taskWorkspaceMode);
  const setMode = useWorkspace((state) => state.setTaskWorkspaceMode);
  const active = tasks.filter(
    (task) => task.status === 'queued' || task.status === 'running',
  ).length;
  const previewCount = inputs.reduce(
    (total, input) => total + (input.mediaCount ?? (input.kind === 'file' ? 1 : 0)),
    0,
  );

  return (
    <div className="tasks-view">
      <div className="task-workspace-switcher" aria-label="任务监控与历史记录">
        <button
          aria-pressed={mode === 'monitor'}
          className={mode === 'monitor' ? 'is-active' : ''}
          onClick={() => setMode('monitor')}
          type="button"
        >
          <Activity size={17} />
          <span>
            <strong>任务监控</strong>
            <small>
              {previewCount > 0
                ? `${previewCount} 个待处理媒体`
                : active > 0
                  ? `${active} 项活动任务`
                  : '当前空闲'}
            </small>
          </span>
        </button>
        <button
          aria-pressed={mode === 'history'}
          className={mode === 'history' ? 'is-active' : ''}
          onClick={() => setMode('history')}
          type="button"
        >
          <History size={17} />
          <span>
            <strong>历史记录</strong>
            <small>{tasks.length} 条本机快照</small>
          </span>
        </button>
      </div>
      {mode === 'monitor' ? (
        <TaskMonitor />
      ) : (
        <div className="task-history-shell">
          <TaskHistory />
        </div>
      )}
    </div>
  );
}

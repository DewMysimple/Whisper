import { SegmentedCard } from '../SegmentedCard';
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

  const navigation = (
    <div className="task-workspace-switcher" aria-label="任务监控与历史记录">
      <SegmentedCard
        label="任务监控"
        value={active}
        description={
          previewCount > 0
            ? `${previewCount} 个待处理媒体`
            : active > 0
              ? '排队或转录中'
              : '当前空闲'
        }
        selected={mode === 'monitor'}
        onClick={() => setMode('monitor')}
      />
      <SegmentedCard
        label="历史记录"
        value={tasks.length}
        description="本机任务快照"
        selected={mode === 'history'}
        onClick={() => setMode('history')}
      />
    </div>
  );
  return (
    <div className="tasks-view">
      {mode === 'monitor' ? (
        <TaskMonitor navigation={navigation} />
      ) : (
        <div className="task-history-shell">
          <TaskHistory navigation={navigation} />
        </div>
      )}
    </div>
  );
}

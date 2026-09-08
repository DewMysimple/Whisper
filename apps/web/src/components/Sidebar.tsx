import {
  Activity,
  AudioLines,
  ChartNoAxesCombined,
  ChevronLeft,
  Cpu,
  Microchip,
  Layers3,
  ScrollText,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { useWorkspace, type WorkspaceViewId } from '../state/workspace';

const SIDEBAR_STORAGE_KEY = 'whisper-subtitle.sidebar-collapsed.v1';

const NAVIGATION: Array<{
  id: WorkspaceViewId;
  label: string;
  icon: typeof AudioLines;
}> = [
  { id: 'workspace', label: '转录工作台', icon: AudioLines },
  { id: 'models', label: '模型切换', icon: Cpu },
  { id: 'hardware', label: '硬件优化', icon: Microchip },
  { id: 'performance', label: '性能监控', icon: ChartNoAxesCombined },
  { id: 'tasks', label: '任务监控与记录', icon: Layers3 },
  { id: 'logs', label: 'Worker 日志', icon: ScrollText },
  { id: 'settings', label: '偏好设置', icon: Settings2 },
];

export function Sidebar() {
  const activeView = useWorkspace((state) => state.activeView);
  const setActiveView = useWorkspace((state) => state.setActiveView);
  const hostStatus = useWorkspace((state) => state.hostStatus);
  const environment = useWorkspace((state) => state.environment);
  const model = useWorkspace((state) => state.model);
  const restartWorker = useWorkspace((state) => state.restartWorker);
  const isReady = hostStatus.state === 'ready';
  const remainingMediaCount = useWorkspace((state) => {
    const activeTask =
      state.tasks.find((task) => task.status === 'running') ??
      state.tasks.find((task) => task.status === 'queued');
    if (!activeTask) return 0;
    if (activeTask.mediaStates && activeTask.mediaStates.length > 0) {
      return activeTask.mediaStates.filter(
        (media) => media.status !== 'completed' && media.status !== 'skipped',
      ).length;
    }
    const total = activeTask.processingCount ?? activeTask.sourceCount;
    const completedBeforeCurrent =
      activeTask.status === 'running' ? Math.max(0, (activeTask.currentMediaIndex ?? 1) - 1) : 0;
    return Math.max(0, total - completedBeforeCurrent);
  });
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
    } catch {
      // A restricted WebView may deny optional UI preference persistence.
    }
    return () => document.body.classList.remove('sidebar-collapsed');
  }, [collapsed]);

  return (
    <aside className="sidebar" id="app-sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <AudioLines size={22} />
        </div>
        <div className="brand-copy">
          <strong>Whisper</strong>
          <span>SUBTITLE DESK</span>
        </div>
        <button
          aria-controls="app-sidebar"
          aria-expanded={!collapsed}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          className="sidebar-toggle"
          onClick={() => setCollapsed((current) => !current)}
          type="button"
        >
          <ChevronLeft size={17} />
        </button>
      </div>

      <nav aria-label="主导航">
        <p className="eyebrow nav-label">LOCAL DESK</p>
        {NAVIGATION.map((item) => {
          const Icon = item.icon;
          return (
            <button
              aria-current={activeView === item.id ? 'page' : undefined}
              className={`nav-item ${activeView === item.id ? 'is-active' : ''}`}
              key={item.id}
              onClick={() => setActiveView(item.id)}
              type="button"
            >
              <Icon size={18} />
              <span>{item.label}</span>
              {item.id === 'tasks' && remainingMediaCount > 0 && (
                <span className="nav-count">{remainingMediaCount}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-spacer" />
      <section className="engine-card" aria-label="本地引擎状态">
        <div className="engine-heading">
          <span className={`status-dot ${isReady ? '' : 'is-waiting'}`} />
          <span>{isReady ? '本地 Worker 就绪' : `Worker ${hostStatus.state}`}</span>
          <Activity size={15} />
        </div>
        <strong>{model.device ? `${model.device.toUpperCase()} 推理` : '模型尚未加载'}</strong>
        <span>
          {model.computeType ??
            (environment?.available ? `Python ${environment.python}` : '等待环境自检')}
          {' · '}离线
        </span>
        <div className="engine-rule" />
        <div className="engine-mode">
          <Sparkles size={14} />
          <span>
            {hostStatus.launchKind === 'mock' ? '交互预览使用模拟数据' : 'Desktop IPC v1'}
          </span>
        </div>
        {hostStatus.state === 'failed' && (
          <button className="engine-restart" onClick={() => void restartWorker()} type="button">
            重启 Worker
          </button>
        )}
      </section>
      <p className="build-label">DESKTOP IPC V1 · OFFLINE</p>
    </aside>
  );
}

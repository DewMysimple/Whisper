import { Activity, AudioLines, Layers3, Settings2, Sparkles } from 'lucide-react';

import { useWorkspace } from '../state/workspace';

const NAVIGATION = [
  { id: 'workspace' as const, label: '转录工作台', icon: AudioLines },
  { id: 'tasks' as const, label: '任务记录', icon: Layers3 },
  { id: 'settings' as const, label: '偏好设置', icon: Settings2 },
];

export function Sidebar() {
  const activeView = useWorkspace((state) => state.activeView);
  const setActiveView = useWorkspace((state) => state.setActiveView);
  const hostStatus = useWorkspace((state) => state.hostStatus);
  const environment = useWorkspace((state) => state.environment);
  const model = useWorkspace((state) => state.model);
  const restartWorker = useWorkspace((state) => state.restartWorker);
  const isReady = hostStatus.state === 'ready';
  const taskCount = useWorkspace((state) => state.tasks.length);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <AudioLines size={23} />
        </div>
        <div>
          <strong>Whisper</strong>
          <span>SUBTITLE STUDIO</span>
        </div>
      </div>

      <nav aria-label="主导航">
        <p className="eyebrow nav-label">工作空间</p>
        {NAVIGATION.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={`nav-item ${activeView === item.id ? 'is-active' : ''}`}
              key={item.id}
              onClick={() => setActiveView(item.id)}
              type="button"
            >
              <Icon size={18} />
              <span>{item.label}</span>
              {item.id === 'tasks' && <span className="nav-count">{taskCount}</span>}
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
      <p className="build-label">CONTROLLED LOCAL IPC · BATCH 05</p>
    </aside>
  );
}

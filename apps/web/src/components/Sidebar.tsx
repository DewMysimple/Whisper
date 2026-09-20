import {
  Activity,
  AudioLines,
  ChartNoAxesCombined,
  ChevronLeft,
  Layers3,
  ScrollText,
  Settings2,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import { DEFAULT_APPEARANCE, SIDEBAR_WIDTH_RANGE } from '../state/persistence';
import { useWorkspace, type WorkspaceViewId } from '../state/workspace';

const SIDEBAR_STORAGE_KEY = 'whisper-subtitle.sidebar-collapsed.v1';

const NAVIGATION: Array<{
  id: WorkspaceViewId;
  label: string;
  icon: typeof AudioLines;
}> = [
  { id: 'workspace', label: '转录工作台', icon: AudioLines },
  { id: 'configuration', label: '模型与参数', icon: SlidersHorizontal },
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
  const sidebarWidth = useWorkspace((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkspace((state) => state.setSidebarWidth);
  const isReady = hostStatus.state === 'ready';
  const dragStateRef = useRef<{ pointerId: number; startWidth: number; startX: number } | null>(
    null,
  );
  const [resizing, setResizing] = useState(false);
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

  useEffect(
    () => () => {
      document.body.classList.remove('sidebar-resizing');
    },
    [],
  );

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (collapsed || event.button !== 0) return;
    event.preventDefault();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startWidth: sidebarWidth,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.classList.add('sidebar-resizing');
    setResizing(true);
  };

  const resizeSidebar = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (dragState === null || dragState.pointerId !== event.pointerId) return;
    const nextWidth = Math.min(
      SIDEBAR_WIDTH_RANGE.maximum,
      Math.max(
        SIDEBAR_WIDTH_RANGE.minimum,
        Math.round(dragState.startWidth + event.clientX - dragState.startX),
      ),
    );
    setSidebarWidth(nextWidth);
  };

  const finishSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    document.body.classList.remove('sidebar-resizing');
    setResizing(false);
  };

  const resizeSidebarWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextWidth = sidebarWidth;
    if (event.key === 'ArrowLeft') nextWidth -= SIDEBAR_WIDTH_RANGE.step;
    else if (event.key === 'ArrowRight') nextWidth += SIDEBAR_WIDTH_RANGE.step;
    else if (event.key === 'Home') nextWidth = SIDEBAR_WIDTH_RANGE.minimum;
    else if (event.key === 'End') nextWidth = SIDEBAR_WIDTH_RANGE.maximum;
    else return;
    event.preventDefault();
    setSidebarWidth(
      Math.min(SIDEBAR_WIDTH_RANGE.maximum, Math.max(SIDEBAR_WIDTH_RANGE.minimum, nextWidth)),
    );
  };

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
      <div
        aria-label="拖拽调整导航栏宽度"
        aria-orientation="vertical"
        aria-valuemax={SIDEBAR_WIDTH_RANGE.maximum}
        aria-valuemin={SIDEBAR_WIDTH_RANGE.minimum}
        aria-valuenow={sidebarWidth}
        aria-valuetext={`${sidebarWidth} 像素`}
        className={`sidebar-resize-handle ${resizing ? 'is-resizing' : ''}`}
        onDoubleClick={() => setSidebarWidth(DEFAULT_APPEARANCE.sidebarWidth)}
        onKeyDown={resizeSidebarWithKeyboard}
        onPointerCancel={finishSidebarResize}
        onPointerDown={startSidebarResize}
        onPointerMove={resizeSidebar}
        onPointerUp={finishSidebarResize}
        role="separator"
        tabIndex={collapsed ? -1 : 0}
      >
        <span aria-hidden="true" />
      </div>
    </aside>
  );
}

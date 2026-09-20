import { ConfigurationView } from './components/ConfigurationView';
import { AlertTriangle, ChevronDown, ChevronUp, Moon, Search, Sun, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import { desktopBridge } from './bridge';
import { LaunchCard } from './components/LaunchCard';
import { OutputPanel } from './components/OutputPanel';
import { OverwriteConfirmDialog } from './components/OverwriteConfirmDialog';
import { PerformanceView } from './components/PerformanceStrip';
import { PowerCountdownBanner } from './components/PowerCountdownBanner';
import { PresetPanel } from './components/PresetPanel';
import { SettingsView } from './components/SettingsView';
import { ShutdownConfirmDialog } from './components/ShutdownConfirmDialog';
import { Sidebar } from './components/Sidebar';
import { SourcePanel } from './components/SourcePanel';
import { SubtitleProfilePanel } from './components/SubtitleProfilePanel';
import { TaskDetail } from './components/TaskDetail';
import { TasksView } from './components/tasks/TasksView';
import { WorkerLogsView } from './components/WorkerLogsView';
import { DEFAULT_APPEARANCE, TOPBAR_HEIGHT_RANGE } from './state/persistence';
import { useWorkspace, type WorkspaceViewId } from './state/workspace';

const PAGE_COPY: Record<WorkspaceViewId, { eyebrow: string; title: string }> = {
  configuration: { eyebrow: 'INFERENCE WORKBENCH', title: '模型与参数' },
  workspace: {
    eyebrow: 'LOCAL TRANSCRIPTION',
    title: '转录工作台',
  },
  tasks: {
    eyebrow: 'LOCAL QUEUE',
    title: '任务监控与记录',
  },
  performance: {
    eyebrow: 'SYSTEM INSIGHT',
    title: '性能监控',
  },
  logs: {
    eyebrow: 'LOCAL DIAGNOSTICS',
    title: 'Worker 日志',
  },
  settings: {
    eyebrow: 'DESK SETTINGS',
    title: '偏好设置',
  },
};

function TopbarResizeHandle() {
  const topbarHeight = useWorkspace((state) => state.topbarHeight);
  const setTopbarHeight = useWorkspace((state) => state.setTopbarHeight);
  const dragStateRef = useRef<{
    pointerId: number;
    startHeight: number;
    startY: number;
  } | null>(null);
  const [resizing, setResizing] = useState(false);

  useEffect(
    () => () => {
      document.body.classList.remove('topbar-resizing');
    },
    [],
  );

  const startTopbarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startHeight: topbarHeight,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.classList.add('topbar-resizing');
    setResizing(true);
  };

  const resizeTopbar = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (dragState === null || dragState.pointerId !== event.pointerId) return;
    const nextHeight = Math.min(
      TOPBAR_HEIGHT_RANGE.maximum,
      Math.max(
        TOPBAR_HEIGHT_RANGE.minimum,
        Math.round(dragState.startHeight + event.clientY - dragState.startY),
      ),
    );
    setTopbarHeight(nextHeight);
  };

  const finishTopbarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    document.body.classList.remove('topbar-resizing');
    setResizing(false);
  };

  const resizeTopbarWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextHeight = topbarHeight;
    if (event.key === 'ArrowUp') nextHeight -= TOPBAR_HEIGHT_RANGE.step;
    else if (event.key === 'ArrowDown') nextHeight += TOPBAR_HEIGHT_RANGE.step;
    else if (event.key === 'Home') nextHeight = TOPBAR_HEIGHT_RANGE.minimum;
    else if (event.key === 'End') nextHeight = TOPBAR_HEIGHT_RANGE.maximum;
    else return;
    event.preventDefault();
    setTopbarHeight(
      Math.min(TOPBAR_HEIGHT_RANGE.maximum, Math.max(TOPBAR_HEIGHT_RANGE.minimum, nextHeight)),
    );
  };

  return (
    <div
      aria-label="拖拽调整顶栏高度"
      aria-orientation="horizontal"
      aria-valuemax={TOPBAR_HEIGHT_RANGE.maximum}
      aria-valuemin={TOPBAR_HEIGHT_RANGE.minimum}
      aria-valuenow={topbarHeight}
      aria-valuetext={`${topbarHeight} 像素`}
      className={`topbar-resize-handle ${resizing ? 'is-resizing' : ''}`}
      onDoubleClick={() => setTopbarHeight(DEFAULT_APPEARANCE.topbarHeight)}
      onKeyDown={resizeTopbarWithKeyboard}
      onPointerCancel={finishTopbarResize}
      onPointerDown={startTopbarResize}
      onPointerMove={resizeTopbar}
      onPointerUp={finishTopbarResize}
      role="separator"
      tabIndex={0}
    >
      <span aria-hidden="true" />
    </div>
  );
}

function Topbar() {
  const collapsed = useWorkspace((state) => state.topbarCollapsed);
  const setCollapsed = useWorkspace((state) => state.setTopbarCollapsed);
  const hostStatus = useWorkspace((state) => state.hostStatus);
  const activeView = useWorkspace((state) => state.activeView);
  const setActiveView = useWorkspace((state) => state.setActiveView);
  const setTaskWorkspaceMode = useWorkspace((state) => state.setTaskWorkspaceMode);
  const theme = useWorkspace((state) => state.theme);
  const setTheme = useWorkspace((state) => state.setTheme);
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() =>
    window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
  );
  const isMock = hostStatus.launchKind === 'mock';
  const copy = PAGE_COPY[activeView];

  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-color-scheme: light)');
    const handleChange = (event: MediaQueryListEvent) =>
      setSystemTheme(event.matches ? 'light' : 'dark');
    preference?.addEventListener?.('change', handleChange);
    return () => preference?.removeEventListener?.('change', handleChange);
  }, []);

  const resolvedTheme = theme === 'system' ? systemTheme : theme;
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';

  return (
    <header className={`topbar ${collapsed ? 'is-collapsed' : ''}`}>
      <button
        type="button"
        className="topbar-collapse-button"
        aria-label={collapsed ? '展开顶栏' : '收起顶栏'}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      <div className="title-block">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
      </div>
      <div className="topbar-actions">
        <div className="mock-pill">
          <span className={hostStatus.state === 'ready' ? '' : 'is-waiting'} />
          {isMock ? 'MOCK BRIDGE' : `LOCAL IPC · ${hostStatus.state.toUpperCase()}`}
        </div>
        <button
          aria-label="搜索任务"
          className="round-button"
          onClick={() => {
            setActiveView('tasks');
            setTaskWorkspaceMode('history');
            window.requestAnimationFrame(() =>
              document.querySelector<HTMLInputElement>('#task-history-search')?.focus(),
            );
          }}
          type="button"
        >
          <Search size={18} />
        </button>
        <button
          aria-label={`切换为${nextTheme === 'dark' ? '深色' : '浅色'}主题`}
          className="round-button theme-button"
          data-mode={theme.toUpperCase()}
          onClick={() => setTheme(nextTheme)}
          type="button"
        >
          {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
      {!collapsed && <TopbarResizeHandle />}
    </header>
  );
}

function WorkspaceView() {
  const profileMode = useWorkspace((state) => state.profileMode);
  return (
    <div className="workspace-grid" data-profile-mode={profileMode}>
      <div className="workspace-primary">
        <SourcePanel />
        <PresetPanel />
        <SubtitleProfilePanel />
      </div>
      <div className="workspace-secondary">
        <OutputPanel />
        <LaunchCard />
      </div>
    </div>
  );
}

function ErrorBanner() {
  const lastError = useWorkspace((state) => state.lastError);
  const clearError = useWorkspace((state) => state.clearError);
  const reducedMotion = useReducedMotion();
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!lastError) {
      setFading(false);
      return;
    }
    setFading(false);
    const fadeTimer = reducedMotion ? null : window.setTimeout(() => setFading(true), 4_840);
    const clearTimer = window.setTimeout(clearError, 5_000);
    return () => {
      if (fadeTimer !== null) window.clearTimeout(fadeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [clearError, lastError, reducedMotion]);

  if (!lastError) return null;
  return (
    <motion.div
      animate={{ opacity: fading ? 0 : 1 }}
      className="error-banner"
      initial={false}
      role="alert"
      transition={{ duration: reducedMotion ? 0 : 0.16, ease: 'easeOut' }}
    >
      <AlertTriangle size={17} />
      <span>{lastError}</span>
      <button aria-label="关闭错误提示" onClick={clearError} type="button">
        <X size={16} />
      </button>
    </motion.div>
  );
}

export default function App() {
  const activeView = useWorkspace((state) => state.activeView);
  const initialize = useWorkspace((state) => state.initialize);
  const reducedMotion = useReducedMotion();

  useEffect(() => initialize(), [initialize]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [activeView]);

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-canvas">
        <Topbar />
        <PowerCountdownBanner />
        <ErrorBanner />
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="view-content"
          initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
          key={activeView}
          transition={
            reducedMotion
              ? { duration: 0.14, ease: 'easeOut' }
              : { type: 'spring', bounce: 0, duration: 0.32 }
          }
        >
          {activeView === 'workspace' && <WorkspaceView />}
          {activeView === 'configuration' && <ConfigurationView />}
          {activeView === 'performance' && <PerformanceView />}
          {activeView === 'tasks' && <TasksView />}
          {activeView === 'logs' && <WorkerLogsView />}
          {activeView === 'settings' && <SettingsView />}
        </motion.div>
      </main>
      <TaskDetail />
      <ShutdownConfirmDialog />
      <OverwriteConfirmDialog />
      <div className="desktop-only" aria-hidden="true">
        {desktopBridge.mode === 'mock' ? 'Mock desktop bridge' : 'Tauri desktop bridge'}
      </div>
    </div>
  );
}

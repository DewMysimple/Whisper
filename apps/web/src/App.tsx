import { Activity, AlertTriangle, History, Moon, Search, Sun, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

import { desktopBridge } from './bridge';
import { HardwareOptimizationPanel } from './components/HardwareOptimizationPanel';
import { LaunchCard } from './components/LaunchCard';
import { ModelSwitchView } from './components/ModelSwitchView';
import { OutputPanel } from './components/OutputPanel';
import { OverwriteConfirmDialog } from './components/OverwriteConfirmDialog';
import { PerformanceView } from './components/PerformanceStrip';
import { PresetPanel } from './components/PresetPanel';
import { PowerCountdownBanner } from './components/PowerCountdownBanner';
import { SubtitleProfilePanel } from './components/SubtitleProfilePanel';
import { Sidebar } from './components/Sidebar';
import { SourcePanel } from './components/SourcePanel';
import { SettingsView } from './components/SettingsView';
import { ShutdownConfirmDialog } from './components/ShutdownConfirmDialog';
import { TaskDetail } from './components/TaskDetail';
import { TaskList } from './components/TaskList';
import { TaskMonitor } from './components/TaskMonitor';
import { WorkerLogsView } from './components/WorkerLogsView';
import { isAbnormalTask, useWorkspace, type WorkspaceViewId } from './state/workspace';

const PAGE_COPY: Record<WorkspaceViewId, { eyebrow: string; title: string }> = {
  workspace: {
    eyebrow: 'LOCAL TRANSCRIPTION',
    title: '转录工作台',
  },
  models: {
    eyebrow: 'LOCAL MODEL LIBRARY',
    title: '模型切换',
  },
  hardware: {
    eyebrow: 'LOCAL COMPUTE',
    title: '硬件优化',
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

function Topbar() {
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
    <header className="topbar">
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

function HardwareView() {
  return (
    <div className="hardware-workspace">
      <HardwareOptimizationPanel />
    </div>
  );
}

function TasksView() {
  const tasks = useWorkspace((state) => state.tasks);
  const mode = useWorkspace((state) => state.taskWorkspaceMode);
  const setMode = useWorkspace((state) => state.setTaskWorkspaceMode);
  const active = tasks.filter(
    (task) => task.status === 'queued' || task.status === 'running',
  ).length;
  const completed = tasks.filter(
    (task) => task.status === 'completed' && task.outputAvailability !== 'missing',
  ).length;
  const attention = tasks.filter(isAbnormalTask).length;

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
            <small>{active > 0 ? `${active} 项活动任务` : '当前空闲'}</small>
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
        <>
          <div className="task-summary task-summary-band" aria-label="任务概览">
            <div className="task-summary-card">
              <small>全部任务</small>
              <strong>{tasks.length}</strong>
              <span>本地历史快照</span>
            </div>
            <div className="task-summary-card">
              <small>正在运行</small>
              <strong>{active}</strong>
              <span>排队或转录中</span>
            </div>
            <div className="task-summary-card">
              <small>已完成</small>
              <strong>{completed}</strong>
              <span>本地输出已生成</span>
            </div>
            <div className="task-summary-card">
              <small>需要处理</small>
              <strong>{attention}</strong>
              <span>失败、取消或输出丢失</span>
            </div>
          </div>
          <TaskList expanded />
        </>
      )}
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
    if (activeView === 'performance') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
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
          {activeView === 'models' && <ModelSwitchView />}
          {activeView === 'hardware' && <HardwareView />}
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

import { AlertTriangle, Moon, Search, Sun, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

import { desktopBridge } from './bridge';
import { HelpTip } from './components/HelpTip';
import { LaunchCard } from './components/LaunchCard';
import { ModelSwitchView } from './components/ModelSwitchView';
import { OutputPanel } from './components/OutputPanel';
import { OverwriteConfirmDialog } from './components/OverwriteConfirmDialog';
import { PerformanceView } from './components/PerformanceStrip';
import { PresetPanel } from './components/PresetPanel';
import { SubtitleProfilePanel } from './components/SubtitleProfilePanel';
import { Sidebar } from './components/Sidebar';
import { SourcePanel } from './components/SourcePanel';
import { SettingsView } from './components/SettingsView';
import { TaskDetail } from './components/TaskDetail';
import { TaskList } from './components/TaskList';
import { WorkerLogsView } from './components/WorkerLogsView';
import { isAbnormalTask, useWorkspace, type WorkspaceViewId } from './state/workspace';

const PAGE_COPY: Record<WorkspaceViewId, { eyebrow: string; title: string; summary: string }> = {
  workspace: {
    eyebrow: 'LOCAL TRANSCRIPTION',
    title: '转录工作台',
    summary: '添加媒体、选择方案并开始本地转录。',
  },
  models: {
    eyebrow: 'LOCAL MODEL LIBRARY',
    title: '模型切换',
    summary: '管理本地模型，并为新任务选择冻结的推理模型。',
  },
  tasks: {
    eyebrow: 'LOCAL QUEUE',
    title: '任务记录',
    summary: '查看任务快照、输出与重试状态。',
  },
  performance: {
    eyebrow: 'SYSTEM INSIGHT',
    title: '性能监控',
    summary: '查看 GPU、显存、CPU 与内存的实时趋势。',
  },
  logs: {
    eyebrow: 'LOCAL DIAGNOSTICS',
    title: 'Worker 日志',
    summary: '查看本机 Worker 的实时诊断输出与运行状态。',
  },
  settings: {
    eyebrow: 'DESK SETTINGS',
    title: '偏好设置',
    summary: '管理界面、Worker 与便携配置。',
  },
};

function Topbar() {
  const hostStatus = useWorkspace((state) => state.hostStatus);
  const activeView = useWorkspace((state) => state.activeView);
  const setActiveView = useWorkspace((state) => state.setActiveView);
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
        <div className="title-heading-row">
          <h1>{copy.title}</h1>
          <HelpTip id={`page-summary-${activeView}`} label="查看当前页面说明">
            {copy.summary}
          </HelpTip>
        </div>
      </div>
      <div className="topbar-actions">
        <div className="mock-pill">
          <span className={hostStatus.state === 'ready' ? '' : 'is-waiting'} />
          {isMock ? 'MOCK BRIDGE' : `LOCAL IPC · ${hostStatus.state.toUpperCase()}`}
        </div>
        <button
          aria-label="搜索任务"
          className="round-button"
          onClick={() => setActiveView('tasks')}
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

function TasksView() {
  const tasks = useWorkspace((state) => state.tasks);
  const active = tasks.filter(
    (task) => task.status === 'queued' || task.status === 'running',
  ).length;
  const completed = tasks.filter(
    (task) => task.status === 'completed' && task.outputAvailability !== 'missing',
  ).length;
  const attention = tasks.filter(isAbnormalTask).length;

  return (
    <div className="tasks-view">
      <div className="task-summary" aria-label="任务概览">
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
    </div>
  );
}

function ErrorBanner() {
  const lastError = useWorkspace((state) => state.lastError);
  const clearError = useWorkspace((state) => state.clearError);
  if (!lastError) return null;
  return (
    <div className="error-banner" role="alert">
      <AlertTriangle size={17} />
      <span>{lastError}</span>
      <button aria-label="关闭错误提示" onClick={clearError} type="button">
        <X size={16} />
      </button>
    </div>
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
          {activeView === 'performance' && <PerformanceView />}
          {activeView === 'tasks' && <TasksView />}
          {activeView === 'logs' && <WorkerLogsView />}
          {activeView === 'settings' && <SettingsView />}
        </motion.div>
      </main>
      <TaskDetail />
      <OverwriteConfirmDialog />
      <div className="desktop-only" aria-hidden="true">
        {desktopBridge.mode === 'mock' ? 'Mock desktop bridge' : 'Tauri desktop bridge'}
      </div>
    </div>
  );
}

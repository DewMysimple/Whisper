import { AlertTriangle, ChevronRight, Command, Play, Search, Settings2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect } from 'react';

import { desktopBridge } from './bridge';
import { OutputPanel } from './components/OutputPanel';
import { PerformanceStrip } from './components/PerformanceStrip';
import { PresetPanel } from './components/PresetPanel';
import { Sidebar } from './components/Sidebar';
import { SourcePanel } from './components/SourcePanel';
import { SettingsView } from './components/SettingsView';
import { TaskDetail } from './components/TaskDetail';
import { TaskList } from './components/TaskList';
import { useWorkspace } from './state/workspace';

function Topbar() {
  const hostStatus = useWorkspace((state) => state.hostStatus);
  const isMock = hostStatus.launchKind === 'mock';
  const setActiveView = useWorkspace((state) => state.setActiveView);
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">LOCAL TRANSCRIPTION WORKSPACE</p>
        <h1>把声音，整理成可用的文字。</h1>
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
          aria-label="设置"
          className="round-button"
          onClick={() => setActiveView('settings')}
          type="button"
        >
          <Settings2 size={18} />
        </button>
      </div>
    </header>
  );
}

function WorkspaceView() {
  const inputs = useWorkspace((state) => state.inputs);
  const selectedPresetId = useWorkspace((state) => state.selectedPresetId);
  const overrides = useWorkspace((state) => state.overrides);
  const startTask = useWorkspace((state) => state.startTask);
  const hostStatus = useWorkspace((state) => state.hostStatus);
  const startingTask = useWorkspace((state) => state.startingTask);
  const output = useWorkspace((state) => state.output);
  const hasInvalidInput = inputs.some((input) => !input.valid);
  const needsOutputRoot = output.mode === 'custom' && output.rootDirectory === null;
  const canStart =
    inputs.length > 0 &&
    !hasInvalidInput &&
    !needsOutputRoot &&
    hostStatus.state === 'ready' &&
    !startingTask;

  return (
    <>
      <PerformanceStrip />
      <div className="workspace-grid">
        <div className="workspace-primary">
          <SourcePanel />
          <PresetPanel />
        </div>
        <div className="workspace-secondary">
          <OutputPanel />
          <section className="launch-card">
            <div className="launch-glow" />
            <p className="step-label">READY TO RUN</p>
            <h2>{inputs.length > 0 ? `${inputs.length} 个来源已就绪` : '等待输入来源'}</h2>
            <p>
              {needsOutputRoot
                ? '请选择真实输出目录'
                : hasInvalidInput
                  ? '请先处理无效输入'
                  : `${Object.keys(overrides).length > 0 ? '自定义参数' : '稳定 preset'} · ${selectedPresetId} · 本地离线处理`}
            </p>
            <button
              className="primary-button"
              disabled={!canStart}
              onClick={() => void startTask()}
              type="button"
            >
              <Play fill="currentColor" size={17} />
              {startingTask ? '正在准备本地模型…' : '开始本地转录'}
              <ChevronRight size={17} />
            </button>
            <span className="shortcut">
              <Command size={13} /> CTRL + ENTER
            </span>
          </section>
          <TaskList />
        </div>
      </div>
    </>
  );
}

function TasksView() {
  return (
    <div className="placeholder-view">
      <Search size={30} />
      <p className="step-label">CONTROLLED LOCAL IPC</p>
      <h2>任务队列与本地历史</h2>
      <p>运行状态、参数快照、失败重试和输出预览使用同一任务记录。</p>
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
  const addFiles = useWorkspace((state) => state.addFiles);
  const startTask = useWorkspace((state) => state.startTask);
  const setActiveView = useWorkspace((state) => state.setActiveView);
  const selectTask = useWorkspace((state) => state.selectTask);

  useEffect(() => initialize(), [initialize]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLocaleLowerCase() === 'o') {
        event.preventDefault();
        void addFiles();
      } else if (modifier && event.key === 'Enter') {
        event.preventDefault();
        void startTask();
      } else if (modifier && ['1', '2', '3'].includes(event.key)) {
        event.preventDefault();
        setActiveView(event.key === '1' ? 'workspace' : event.key === '2' ? 'tasks' : 'settings');
      } else if (event.key === 'Escape') {
        void selectTask(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addFiles, selectTask, setActiveView, startTask]);

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-canvas">
        <Topbar />
        <ErrorBanner />
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="view-content"
          initial={{ opacity: 0, y: 8 }}
          key={activeView}
          transition={{ duration: 0.28, ease: 'easeOut' }}
        >
          {activeView === 'workspace' && <WorkspaceView />}
          {activeView === 'tasks' && <TasksView />}
          {activeView === 'settings' && <SettingsView />}
        </motion.div>
      </main>
      <TaskDetail />
      <div className="desktop-only" aria-hidden="true">
        {desktopBridge.mode === 'mock' ? 'Mock desktop bridge' : 'Tauri desktop bridge'}
      </div>
    </div>
  );
}

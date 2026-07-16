import { Download, Eraser, RotateCcw, Upload } from 'lucide-react';

import { useWorkspace } from '../state/workspace';

export function SettingsView() {
  const theme = useWorkspace((state) => state.theme);
  const setTheme = useWorkspace((state) => state.setTheme);
  const logs = useWorkspace((state) => state.logs);
  const environment = useWorkspace((state) => state.environment);
  const configText = useWorkspace((state) => state.configText);
  const setConfigText = useWorkspace((state) => state.setConfigText);
  const exportConfig = useWorkspace((state) => state.exportConfig);
  const importConfig = useWorkspace((state) => state.importConfig);
  const clearHistory = useWorkspace((state) => state.clearHistory);
  const restartWorker = useWorkspace((state) => state.restartWorker);

  return (
    <div className="settings-grid">
      <section className="panel settings-card">
        <p className="step-label">APPEARANCE</p>
        <h2>桌面外观</h2>
        <label>
          <span>主题</span>
          <select
            aria-label="主题"
            onChange={(event) => setTheme(event.target.value as typeof theme)}
            value={theme}
          >
            <option value="system">跟随系统</option>
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </label>
        <p>界面遵循系统缩放，并在系统要求减少动态效果时停用非必要动画。</p>
      </section>

      <section className="panel settings-card">
        <p className="step-label">LOCAL RUNTIME</p>
        <h2>运行诊断</h2>
        <p>
          {environment?.available
            ? `Python ${environment.python} · 环境可用`
            : '等待 Worker 环境检查'}
        </p>
        <div className="settings-actions">
          <button className="secondary-button" onClick={() => void restartWorker()} type="button">
            <RotateCcw size={16} /> 重启 Worker
          </button>
          <button className="secondary-button" onClick={clearHistory} type="button">
            <Eraser size={16} /> 清除已结束历史
          </button>
        </div>
      </section>

      <section className="panel settings-card config-card">
        <p className="step-label">PORTABLE SETTINGS</p>
        <h2>配置导入与导出</h2>
        <p>只包含主题、preset、参数覆盖和输出策略，不包含任务历史或日志。</p>
        <textarea
          aria-label="配置 JSON"
          onChange={(event) => setConfigText(event.target.value)}
          placeholder="点击导出生成 schemaVersion 1 配置，或粘贴配置后导入。"
          rows={10}
          value={configText}
        />
        <div className="settings-actions">
          <button className="secondary-button" onClick={exportConfig} type="button">
            <Download size={16} /> 生成导出配置
          </button>
          <button className="secondary-button" onClick={importConfig} type="button">
            <Upload size={16} /> 应用导入配置
          </button>
        </div>
      </section>

      <section className="panel settings-card log-card">
        <p className="step-label">STDERR LOG</p>
        <h2>Worker 日志</h2>
        <div className="log-view" aria-label="Worker 日志">
          {logs.length === 0 ? (
            <span>暂无 Worker 日志</span>
          ) : (
            logs.slice(-80).map((line, index) => <code key={`${index}-${line}`}>{line}</code>)
          )}
        </div>
      </section>
    </div>
  );
}

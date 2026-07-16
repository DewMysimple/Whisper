import { FileText, FolderOpen, RotateCcw, X } from 'lucide-react';

import { getPreset } from '../data/presets';
import { useWorkspace } from '../state/workspace';

export function TaskDetail() {
  const selectedTaskId = useWorkspace((state) => state.selectedTaskId);
  const task = useWorkspace((state) =>
    state.tasks.find((item) => item.id === state.selectedTaskId),
  );
  const preview = useWorkspace((state) => state.outputPreview);
  const previewLoading = useWorkspace((state) => state.previewLoading);
  const selectTask = useWorkspace((state) => state.selectTask);
  const retryTask = useWorkspace((state) => state.retryTask);
  const revealTaskOutput = useWorkspace((state) => state.revealTaskOutput);

  if (selectedTaskId === null || task === undefined) return null;
  const parameters = task.draft?.effectiveParameters;

  return (
    <div className="detail-backdrop" onMouseDown={() => void selectTask(null)}>
      <aside
        aria-labelledby="task-detail-title"
        aria-modal="true"
        className="task-detail"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <p className="step-label">TASK SNAPSHOT</p>
            <h2 id="task-detail-title">{task.title}</h2>
          </div>
          <button
            aria-label="关闭任务详情"
            autoFocus
            className="round-button"
            onClick={() => void selectTask(null)}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="detail-status-line">
          <span className={`status-badge ${task.status}`}>{task.status.toUpperCase()}</span>
          <span>{getPreset(task.presetId).label}</span>
          <span>{task.elapsed}</span>
          <span>{task.stage}</span>
        </div>

        <section className="detail-section">
          <h3>输入快照</h3>
          {task.draft?.inputs.map((input) => (
            <code key={`${input.kind}-${input.path}`}>{input.path}</code>
          )) ?? <span>旧任务没有保存输入快照。</span>}
        </section>

        <section className="detail-section">
          <h3>生效参数</h3>
          {parameters ? (
            <dl className="parameter-snapshot">
              {Object.entries(parameters).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <span>旧任务没有保存参数快照。</span>
          )}
        </section>

        {task.outputs && task.outputs.length > 0 && (
          <section className="detail-section">
            <h3>输出文件</h3>
            {task.outputs.map((output) => (
              <code key={output}>{output}</code>
            ))}
          </section>
        )}

        <section className="detail-section preview-section">
          <h3>
            <FileText size={16} /> 输出预览
          </h3>
          {previewLoading ? (
            <span>正在读取本地输出…</span>
          ) : preview ? (
            <>
              <pre>{preview.content}</pre>
              {preview.truncated && <small>预览已截断为前 128 KiB。</small>}
            </>
          ) : (
            <span>任务完成后可预览 TXT 或 Markdown。</span>
          )}
        </section>

        <footer>
          {task.draft && task.status !== 'running' && task.status !== 'queued' && (
            <button
              className="secondary-button"
              onClick={() => void retryTask(task.id)}
              type="button"
            >
              <RotateCcw size={16} /> 按此快照重试
            </button>
          )}
          {(task.outputs?.length ?? 0) > 0 && (
            <button
              className="secondary-button"
              onClick={() => void revealTaskOutput(task.id)}
              type="button"
            >
              <FolderOpen size={16} /> 定位输出
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}

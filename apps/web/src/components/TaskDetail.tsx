import { FileText, FolderOpen, RotateCcw, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { getPreset } from '../data/presets';
import { getModelLabel } from '../data/models';
import { formatResolvedHardware } from '../state/hardware';
import { formatTaskCreatedAt } from '../state/taskHistory';
import { useWorkspace } from '../state/workspace';
import { ConfirmDialog } from './ConfirmDialog';

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
  const startingTask = useWorkspace((state) => state.startingTask);
  const [retryConfirmationOpen, setRetryConfirmationOpen] = useState(false);

  const closeRetryConfirmation = useCallback(() => {
    if (!startingTask) setRetryConfirmationOpen(false);
  }, [startingTask]);

  const confirmRetry = useCallback(async () => {
    if (selectedTaskId === null) return;
    await retryTask(selectedTaskId);
    setRetryConfirmationOpen(false);
  }, [retryTask, selectedTaskId]);

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
          <span
            className={`status-badge ${task.outputAvailability === 'missing' ? 'failed' : task.status}`}
          >
            {task.outputAvailability === 'missing' ? 'OUTPUT MISSING' : task.status.toUpperCase()}
          </span>
          <span>{getPreset(task.presetId).label}</span>
          <span>{getModelLabel(task.modelId)}</span>
          <span>{formatResolvedHardware(task.hardware)}</span>
          <span>{formatTaskCreatedAt(task.createdAt)}</span>
          <span>{task.elapsed}</span>
          <span>{task.outputAvailability === 'missing' ? '输出文件已丢失或移动' : task.stage}</span>
        </div>

        <section className="detail-section">
          <h3>输入快照</h3>
          {task.draft?.inputs.map((input) => (
            <code key={`${input.kind}-${input.path}`}>
              {input.path}
              {input.kind === 'directory' && input.mediaCount !== undefined
                ? ` · 共 ${input.mediaCount} 个媒体文件`
                : ''}
            </code>
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
          ) : task.outputAvailability === 'missing' ? (
            <span>记录中的输出文件已被删除、移动或改名，无法预览。</span>
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
            <span>任务完成后可预览 TXT、Markdown 或 SRT。</span>
          )}
        </section>

        <footer>
          {task.draft && task.status !== 'running' && task.status !== 'queued' && (
            <button
              className="secondary-button"
              onClick={() => setRetryConfirmationOpen(true)}
              type="button"
            >
              <RotateCcw size={16} /> 按此快照重试
            </button>
          )}
          {task.outputAvailability !== 'missing' && (task.outputs?.length ?? 0) > 0 && (
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
      <ConfirmDialog
        confirmLabel="确认重新转录"
        description="软件将按历史快照重新检查输入路径并创建一个新任务；原任务记录和已有输出不会被删除。"
        onCancel={closeRetryConfirmation}
        onConfirm={() => void confirmRetry()}
        open={retryConfirmationOpen}
        pending={startingTask}
        title="确认重新转录？"
      >
        <dl>
          <div>
            <dt>任务</dt>
            <dd>{task.title}</dd>
          </div>
          <div>
            <dt>转录版本</dt>
            <dd>{getPreset(task.presetId).label}</dd>
          </div>
          <div>
            <dt>推理模型</dt>
            <dd>{getModelLabel(task.modelId)}</dd>
          </div>
          <div>
            <dt>硬件配置</dt>
            <dd>{formatResolvedHardware(task.hardware)}</dd>
          </div>
          <div>
            <dt>媒体数量</dt>
            <dd>{task.sourceCount} 个</dd>
          </div>
          <div>
            <dt>输出策略</dt>
            <dd>{task.draft?.output.mode === 'custom' ? '自定义目录' : '跟随媒体'}</dd>
          </div>
        </dl>
      </ConfirmDialog>
    </div>
  );
}

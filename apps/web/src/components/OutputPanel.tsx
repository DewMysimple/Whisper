import { FileText, FolderOutput, ShieldCheck } from 'lucide-react';

import { useWorkspace } from '../state/workspace';

export function OutputPanel() {
  const output = useWorkspace((state) => state.output);
  const setOutput = useWorkspace((state) => state.setOutput);
  const chooseOutputDirectory = useWorkspace((state) => state.chooseOutputDirectory);

  return (
    <section className="panel output-panel" aria-labelledby="output-title">
      <div className="panel-heading">
        <div>
          <p className="step-label">03 · OUTPUT</p>
          <h2 id="output-title">输出策略</h2>
        </div>
        <span className="compatibility-chip">
          <ShieldCheck size={14} /> {output.mode === 'compatibility' ? '兼容模式' : '自定义模式'}
        </span>
      </div>

      <button className="output-path" onClick={() => void chooseOutputDirectory()} type="button">
        <div className="file-badge accent">
          <FolderOutput size={18} />
        </div>
        <span>
          <small>输出根目录</small>
          <strong>{output.rootDirectory ?? '媒体旁 / Text（当前兼容规则）'}</strong>
        </span>
        <em>更改</em>
      </button>

      <div className="format-row">
        <label className="format-option">
          <FileText size={18} />
          <span>
            <strong>纯文本 TXT</strong>
            <small>Text 子目录</small>
          </span>
          <input
            checked={output.txtEnabled}
            onChange={(event) => setOutput({ txtEnabled: event.target.checked })}
            type="checkbox"
          />
        </label>
        <label className="format-option">
          <FileText size={18} />
          <span>
            <strong>Markdown</strong>
            <small>默认关闭</small>
          </span>
          <input
            checked={output.markdownEnabled}
            onChange={(event) => setOutput({ markdownEnabled: event.target.checked })}
            type="checkbox"
          />
        </label>
      </div>

      <div className="output-footnote">
        <span>同名冲突</span>
        <select
          aria-label="同名冲突策略"
          onChange={(event) =>
            setOutput({ conflictPolicy: event.target.value as 'fail' | 'auto_rename' })
          }
          value={output.conflictPolicy}
        >
          <option value="fail">执行前阻止并提示</option>
          <option value="auto_rename">自动安全重命名</option>
        </select>
      </div>
      {output.mode === 'custom' && (
        <button
          className="quiet-button output-reset"
          onClick={() =>
            setOutput({
              mode: 'compatibility',
              rootDirectory: null,
              txtEnabled: true,
              markdownEnabled: false,
              preserveSourceTxt: true,
              conflictPolicy: 'fail',
            })
          }
          type="button"
        >
          恢复兼容输出规则
        </button>
      )}
    </section>
  );
}

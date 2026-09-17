import { Copy, FileText, FolderOutput, Power, RotateCcw, ShieldCheck } from 'lucide-react';

import { useWorkspace } from '../state/workspace';

const CONFLICT_POLICY_SUMMARY = {
  confirm_overwrite: '覆盖同名文件前会请求确认',
  confirm_skip: '跳过同名媒体前会请求确认',
  auto_rename: '自动为新文件安全重命名',
} as const;

const CONFLICT_POLICY_OPTIONS = [
  { value: 'confirm_overwrite', label: '覆盖' },
  { value: 'confirm_skip', label: '跳过' },
  { value: 'auto_rename', label: '重命名' },
] as const;

export function OutputPanel() {
  const output = useWorkspace((state) => state.output);
  const setOutput = useWorkspace((state) => state.setOutput);
  const chooseOutputDirectory = useWorkspace((state) => state.chooseOutputDirectory);
  const restoreDefaultOutputDirectory = useWorkspace(
    (state) => state.restoreDefaultOutputDirectory,
  );
  const profileMode = useWorkspace((state) => state.profileMode);
  const finishAction = useWorkspace((state) => state.finishAction);
  const powerCapabilities = useWorkspace((state) => state.powerCapabilities);
  const setFinishAction = useWorkspace((state) => state.setFinishAction);
  const usesCustomLocation = output.mode === 'custom' && output.rootDirectory !== null;
  const enabledDirectories = [
    profileMode === 'subtitle' && output.srtEnabled ? 'SRT' : null,
    output.txtEnabled ? 'Text' : null,
    profileMode === 'transcript' && output.markdownEnabled ? 'Markdown' : null,
  ].filter((directory): directory is string => directory !== null);
  const directoryList = enabledDirectories.join('、');
  const locationDescription =
    directoryList.length === 0
      ? '尚未选择输出格式'
      : usesCustomLocation
        ? `${directoryList} 文件直接写入所选目录，不创建格式子文件夹`
        : `在每个媒体文件旁创建 ${directoryList} 文件夹，文件直接存放`;

  return (
    <section className="panel output-panel output-panel-v3" aria-labelledby="output-title">
      <div className="panel-heading">
        <div>
          <p className="step-label">04 / FILE OUTPUT</p>
          <h2 id="output-title">文件输出</h2>
        </div>
        <span className={`output-location-chip ${usesCustomLocation ? 'is-custom' : ''}`}>
          <FolderOutput size={14} /> {usesCustomLocation ? '自选目录' : '跟随媒体'}
        </span>
      </div>

      <div className="output-settings-grid">
        <section
          className={`output-setting-card output-location-card ${usesCustomLocation ? 'is-custom' : ''}`}
          aria-labelledby="output-location-title"
        >
          <div className="output-setting-card-heading">
            <span className="output-setting-icon" aria-hidden="true">
              <FolderOutput size={16} />
            </span>
            <span>
              <small>保存位置</small>
              <strong id="output-location-title">
                {usesCustomLocation ? '自选输出文件夹' : '跟随每个媒体文件'}
              </strong>
            </span>
          </div>
          <p className="output-setting-description">{locationDescription}</p>
          {usesCustomLocation && <code className="output-path-value">{output.rootDirectory}</code>}
          <div className="output-location-actions">
            <button
              className="output-location-action"
              onClick={() => void chooseOutputDirectory()}
              type="button"
            >
              <FolderOutput size={15} /> {usesCustomLocation ? '更换文件夹' : '选择输出文件夹'}
            </button>
            {usesCustomLocation && (
              <button
                className="output-location-reset"
                onClick={restoreDefaultOutputDirectory}
                type="button"
              >
                <RotateCcw size={15} /> 恢复默认位置
              </button>
            )}
          </div>
        </section>

        <section className="output-setting-card" aria-labelledby="output-format-title">
          <div className="output-setting-card-heading">
            <span className="output-setting-icon" aria-hidden="true">
              <FileText size={16} />
            </span>
            <span>
              <small>文件格式</small>
              <strong id="output-format-title">生成文件</strong>
            </span>
          </div>
          <p className="output-setting-description">至少选择一种需要生成的文件格式。</p>
          {profileMode === 'transcript' ? (
            <div className="output-format-list">
              <label
                className={`selection-card output-format-option ${output.txtEnabled ? 'is-selected' : ''}`}
              >
                <span className="output-format-code" aria-hidden="true">
                  TXT
                </span>
                <span className="output-format-name">纯文本</span>
                <input
                  aria-label="生成 TXT 格式"
                  checked={output.txtEnabled}
                  onChange={(event) =>
                    setOutput({
                      txtEnabled: event.target.checked,
                      preserveSourceTxt: event.target.checked ? output.preserveSourceTxt : false,
                    })
                  }
                  type="checkbox"
                />
              </label>
              <label
                className={`selection-card output-format-option ${output.markdownEnabled ? 'is-selected' : ''}`}
              >
                <span className="output-format-code" aria-hidden="true">
                  MD
                </span>
                <span className="output-format-name">Markdown</span>
                <input
                  aria-label="生成 Markdown 格式"
                  checked={output.markdownEnabled}
                  onChange={(event) =>
                    setOutput({
                      markdownEnabled: event.target.checked,
                      preserveSourceMarkdown: event.target.checked
                        ? output.preserveSourceMarkdown
                        : false,
                    })
                  }
                  type="checkbox"
                />
              </label>
            </div>
          ) : (
            <div className="output-format-list">
              <label
                className={`selection-card output-format-option ${output.srtEnabled ? 'is-selected' : ''}`}
              >
                <span className="output-format-code" aria-hidden="true">
                  SRT
                </span>
                <span className="output-format-name">字幕文件</span>
                <input
                  aria-label="生成 SRT 格式"
                  checked={output.srtEnabled}
                  onChange={(event) => setOutput({ srtEnabled: event.target.checked })}
                  type="checkbox"
                />
              </label>
              <label
                className={`selection-card output-format-option ${output.txtEnabled ? 'is-selected' : ''}`}
              >
                <span className="output-format-code" aria-hidden="true">
                  TXT
                </span>
                <span className="output-format-name">纯文本</span>
                <input
                  aria-label="生成 TXT 格式"
                  checked={output.txtEnabled}
                  onChange={(event) =>
                    setOutput({
                      txtEnabled: event.target.checked,
                      preserveSourceTxt: event.target.checked ? output.preserveSourceTxt : false,
                    })
                  }
                  type="checkbox"
                />
              </label>
            </div>
          )}
        </section>

        <section className="output-setting-card" aria-labelledby="output-conflict-title">
          <div className="output-setting-card-heading">
            <span className="output-setting-icon" aria-hidden="true">
              <ShieldCheck size={16} />
            </span>
            <span>
              <small>写入规则</small>
              <strong id="output-conflict-title">同名文件</strong>
            </span>
          </div>
          <p className="output-setting-description">
            {CONFLICT_POLICY_SUMMARY[output.conflictPolicy]}，确认仅对本次任务生效。
          </p>
          <div className="output-conflict-options" aria-label="同名冲突策略" role="group">
            {CONFLICT_POLICY_OPTIONS.map((option) => (
              <button
                aria-pressed={output.conflictPolicy === option.value}
                className={`selection-card ${output.conflictPolicy === option.value ? 'is-selected' : ''}`}
                key={option.value}
                onClick={() => setOutput({ conflictPolicy: option.value })}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="output-setting-card" aria-labelledby="output-finish-title">
          <div className="output-setting-card-heading">
            <span className="output-setting-icon" aria-hidden="true">
              <Power size={16} />
            </span>
            <span>
              <small>完成动作</small>
              <strong id="output-finish-title">执行完</strong>
            </span>
          </div>
          <p className="output-setting-description">一次性系统操作，不写入任务历史。</p>
          <div className="finish-action-options" aria-label="任务完成后的系统操作">
            <button
              aria-pressed={finishAction === 'none'}
              className={`selection-card ${finishAction === 'none' ? 'is-selected' : ''}`}
              onClick={() => setFinishAction('none')}
              type="button"
            >
              无操作
            </button>
            <button
              aria-pressed={finishAction === 'shutdown'}
              className={`selection-card ${finishAction === 'shutdown' ? 'is-selected' : ''}`}
              disabled={!powerCapabilities.shutdown}
              onClick={() => setFinishAction('shutdown')}
              type="button"
            >
              <Power size={15} /> 关机
            </button>
          </div>
        </section>
      </div>

      {usesCustomLocation &&
        profileMode === 'transcript' &&
        (output.txtEnabled || output.markdownEnabled) && (
          <section className="output-copy-panel" aria-labelledby="output-copy-title">
            <div className="output-copy-heading">
              <span>
                <Copy size={15} />
                <strong id="output-copy-title">媒体旁副本</strong>
              </span>
              <small>可选附加写入</small>
            </div>
            <p>除了自选目录，也可以在原媒体旁保存一份。</p>
            <div className="output-copy-options">
              {output.txtEnabled && (
                <label>
                  <span>
                    <strong>TXT 副本</strong>
                    <small>媒体旁的 Text 文件夹</small>
                  </span>
                  <input
                    aria-label="同时在媒体旁保存 TXT 副本"
                    checked={output.preserveSourceTxt}
                    onChange={(event) => setOutput({ preserveSourceTxt: event.target.checked })}
                    type="checkbox"
                  />
                </label>
              )}
              {output.markdownEnabled && (
                <label>
                  <span>
                    <strong>Markdown 副本</strong>
                    <small>媒体旁的 Markdown 文件夹</small>
                  </span>
                  <input
                    aria-label="同时在媒体旁保存 Markdown 副本"
                    checked={output.preserveSourceMarkdown}
                    onChange={(event) =>
                      setOutput({ preserveSourceMarkdown: event.target.checked })
                    }
                    type="checkbox"
                  />
                </label>
              )}
            </div>
          </section>
        )}
    </section>
  );
}

import { Captions, Check, Copy, FolderOutput, Power, RotateCcw } from 'lucide-react';

import { useWorkspace } from '../state/workspace';

export function OutputPanel() {
  const output = useWorkspace((state) => state.output);
  const setOutput = useWorkspace((state) => state.setOutput);
  const chooseOutputDirectory = useWorkspace((state) => state.chooseOutputDirectory);
  const restoreDefaultOutputDirectory = useWorkspace(
    (state) => state.restoreDefaultOutputDirectory,
  );
  const profileMode = useWorkspace((state) => state.profileMode);
  const subtitleParameters = useWorkspace((state) => state.subtitleParameters);
  const finishAction = useWorkspace((state) => state.finishAction);
  const powerCapabilities = useWorkspace((state) => state.powerCapabilities);
  const setFinishAction = useWorkspace((state) => state.setFinishAction);
  const usesCustomLocation = output.mode === 'custom' && output.rootDirectory !== null;
  const enabledDirectories =
    profileMode === 'subtitle'
      ? ['SRT']
      : [output.txtEnabled ? 'Text' : null, output.markdownEnabled ? 'Markdown' : null].filter(
          (directory): directory is string => directory !== null,
        );
  const directoryList = enabledDirectories.join('、');
  const locationDescription =
    directoryList.length === 0
      ? '尚未选择输出格式'
      : usesCustomLocation
        ? `${directoryList} 文件直接写入所选目录，不创建格式子文件夹`
        : `在每个媒体文件旁创建 ${directoryList} 文件夹，文件直接存放`;

  return (
    <section className="panel output-panel output-panel-v2" aria-labelledby="output-title">
      <div className="panel-heading">
        <div>
          <p className="step-label">04 / FILE OUTPUT</p>
          <h2 id="output-title">文件输出</h2>
        </div>
        <span className={`output-location-chip ${usesCustomLocation ? 'is-custom' : ''}`}>
          <FolderOutput size={14} /> {usesCustomLocation ? '自选目录' : '跟随媒体'}
        </span>
      </div>

      <div className="output-section-heading">
        <strong>输出位置</strong>
        <span>{usesCustomLocation ? '所有任务使用同一根目录' : '默认规则'}</span>
      </div>
      <div className={`output-location-card ${usesCustomLocation ? 'is-custom' : ''}`}>
        <div className="output-location-summary">
          <div className="file-badge accent">
            <FolderOutput size={18} />
          </div>
          <span>
            <strong>{usesCustomLocation ? '自选输出文件夹' : '跟随每个媒体文件'}</strong>
            <small>{locationDescription}</small>
          </span>
        </div>
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
      </div>

      <div className="output-section-heading output-format-heading">
        <strong>生成文件</strong>
        <span>{profileMode === 'subtitle' ? '由 SRT 预设决定' : '至少选择一种格式'}</span>
      </div>
      {profileMode === 'transcript' ? (
        <div className="output-format-list">
          <label className={`output-format-option ${output.txtEnabled ? 'is-enabled' : ''}`}>
            <span className="output-format-code" aria-hidden="true">
              TXT
            </span>
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
          <label className={`output-format-option ${output.markdownEnabled ? 'is-enabled' : ''}`}>
            <span className="output-format-code" aria-hidden="true">
              MD
            </span>
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
        <div className="output-format-option is-enabled is-fixed" aria-label="当前 SRT 输出摘要">
          <span className="output-format-code srt">
            <Captions size={16} />
          </span>
          <span className="output-format-copy">
            <strong>SRT 字幕 + 时间戳 TXT</strong>
            <small>
              两个文件内容完全一致 · {subtitleParameters.max_lines_per_cue} 行 × 每行{' '}
              {subtitleParameters.max_characters_per_line} 字符 ·{' '}
              {subtitleParameters.max_characters_per_second} 字符/秒
            </small>
          </span>
          <Check className="output-format-check" size={18} aria-label="已启用" />
        </div>
      )}

      {usesCustomLocation &&
        profileMode === 'transcript' &&
        (output.txtEnabled || output.markdownEnabled) && (
          <div className="output-copy-panel" aria-labelledby="output-copy-title">
            <div className="output-copy-heading">
              <span>
                <Copy size={15} />
                <strong id="output-copy-title">媒体旁副本</strong>
              </span>
              <small>可选</small>
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
          </div>
        )}

      <div className="output-section-heading output-conflict-heading">
        <strong>同名文件</strong>
        <span>确认只对本次任务生效</span>
      </div>
      <div className="output-conflict-control">
        <select
          aria-label="同名冲突策略"
          onChange={(event) =>
            setOutput({
              conflictPolicy: event.target.value as
                'confirm_overwrite' | 'confirm_skip' | 'auto_rename',
            })
          }
          value={output.conflictPolicy}
        >
          <option value="confirm_overwrite">执行前确认覆盖同名文件</option>
          <option value="confirm_skip">执行前确认跳过同名媒体</option>
          <option value="auto_rename">自动安全重命名</option>
        </select>
      </div>

      <div className="output-section-heading output-finish-heading">
        <strong>执行完</strong>
        <span>一次性操作，不写入任务历史</span>
      </div>
      <div className="finish-action-options" aria-label="任务完成后的系统操作">
        <button
          aria-pressed={finishAction === 'none'}
          className={finishAction === 'none' ? 'is-selected' : ''}
          onClick={() => setFinishAction('none')}
          type="button"
        >
          无操作
        </button>
        <button
          aria-pressed={finishAction === 'shutdown'}
          className={finishAction === 'shutdown' ? 'is-selected' : ''}
          disabled={!powerCapabilities.shutdown}
          onClick={() => setFinishAction('shutdown')}
          type="button"
        >
          <Power size={15} /> 关机
        </button>
      </div>
    </section>
  );
}

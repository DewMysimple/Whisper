import { Captions, Check, Copy, FolderOutput, RotateCcw } from 'lucide-react';

import { useWorkspace } from '../state/workspace';
import { HelpTip } from './HelpTip';

export function OutputPanel() {
  const output = useWorkspace((state) => state.output);
  const setOutput = useWorkspace((state) => state.setOutput);
  const chooseOutputDirectory = useWorkspace((state) => state.chooseOutputDirectory);
  const restoreDefaultOutputDirectory = useWorkspace(
    (state) => state.restoreDefaultOutputDirectory,
  );
  const profileMode = useWorkspace((state) => state.profileMode);
  const subtitleParameters = useWorkspace((state) => state.subtitleParameters);
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
        {usesCustomLocation && (
          <code className="output-path-value" title={output.rootDirectory ?? undefined}>
            {output.rootDirectory}
          </code>
        )}
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
            <span className="output-format-code">TXT</span>
            <span className="output-format-copy">
              <strong>纯文本</strong>
              <small>直接存入 Text 文件夹，适合编辑与后处理</small>
            </span>
            <input
              aria-label="生成 TXT 纯文本"
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
            <span className="output-format-code">MD</span>
            <span className="output-format-copy">
              <strong>Markdown</strong>
              <small>直接存入 Markdown 文件夹，便于笔记软件使用</small>
            </span>
            <input
              aria-label="生成 Markdown 文本"
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
            <strong>SRT 字幕</strong>
            <small>
              {subtitleParameters.max_lines_per_cue} 行 × 每行{' '}
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
            <p>除了自选目录，是否还要在原媒体旁保存一份？</p>
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
        <strong className="output-footnote-label">
          同名文件
          <HelpTip id="output-conflict-help" label="查看同名冲突处理方式" align="right">
            发现同名输出时，会在创建任务前请求本次覆盖确认，或自动安全重命名。
          </HelpTip>
        </strong>
        <span>覆盖必须由本次任务明确确认</span>
      </div>
      <div className="output-conflict-control">
        <select
          aria-label="同名冲突策略"
          onChange={(event) =>
            setOutput({
              conflictPolicy: event.target.value as 'confirm_overwrite' | 'auto_rename',
            })
          }
          value={output.conflictPolicy}
        >
          <option value="confirm_overwrite">执行前确认覆盖同名文件</option>
          <option value="auto_rename">自动安全重命名</option>
        </select>
      </div>
    </section>
  );
}

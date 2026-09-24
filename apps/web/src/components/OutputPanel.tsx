import { FileText, FolderOutput, Power, ShieldCheck } from 'lucide-react';

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
  const selectOutputLocation = useWorkspace((state) => state.selectOutputLocation);
  const profileMode = useWorkspace((state) => state.profileMode);
  const finishAction = useWorkspace((state) => state.finishAction);
  const powerCapabilities = useWorkspace((state) => state.powerCapabilities);
  const setFinishAction = useWorkspace((state) => state.setFinishAction);
  const usesCustomLocation = output.mode === 'custom' && output.rootDirectory !== null;
  const locationMode = output.mode === 'compatibility' ? 'folders' : output.mode;
  const locationLabel = { source: '跟随媒体', folders: '分类文件夹', custom: '自选目录' }[
    locationMode
  ];
  const enabledDirectories = [
    output.txtEnabled || (profileMode === 'transcript' && output.markdownEnabled) ? 'Text' : null,
    profileMode === 'subtitle' && output.srtEnabled ? 'SRT' : null,
  ].filter((directory): directory is string => directory !== null);
  const locationDescription = usesCustomLocation
    ? output.rootDirectory!
    : locationMode === 'source'
      ? '直接保存在每个媒体文件所在目录'
      : enabledDirectories.length > 0
        ? `在每个媒体目录中创建 ${enabledDirectories.join(' / ')} 文件夹`
        : '按格式保存到媒体旁的 Text / SRT 文件夹';

  return (
    <section className="panel output-panel output-panel-v3" aria-labelledby="output-title">
      <div className="panel-heading">
        <div>
          <p className="step-label">04 / FILE OUTPUT</p>
          <h2 id="output-title">文件输出</h2>
        </div>
        <span className={`output-location-chip ${usesCustomLocation ? 'is-custom' : ''}`}>
          <FolderOutput size={14} /> {locationLabel}
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
                {usesCustomLocation
                  ? '自选输出文件夹'
                  : locationMode === 'source'
                    ? '跟随每个媒体文件'
                    : '按格式分类保存'}
              </strong>
            </span>
          </div>
          <p
            className={`output-setting-description output-location-description ${usesCustomLocation ? 'is-path' : ''}`}
          >
            {locationDescription}
          </p>
          <div className="output-location-options" aria-label="文件输出策略" role="group">
            {(
              [
                { value: 'source', label: '跟随' },
                { value: 'folders', label: '文件夹' },
                { value: 'custom', label: '自定义' },
              ] as const
            ).map((option) => (
              <button
                aria-pressed={locationMode === option.value}
                className={`selection-card ${locationMode === option.value ? 'is-selected' : ''}`}
                key={option.value}
                onClick={() =>
                  option.value === 'custom'
                    ? void chooseOutputDirectory()
                    : selectOutputLocation(option.value)
                }
                type="button"
              >
                {option.label}
              </button>
            ))}
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
    </section>
  );
}

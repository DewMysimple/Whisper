import { Check, FileText, FolderOutput, Power, ShieldCheck } from 'lucide-react';

import { useWorkspace } from '../state/workspace';
import './output-panel.css';

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

  const formats =
    profileMode === 'transcript'
      ? ([
          { code: 'TXT', name: '纯文本', key: 'txtEnabled', enabled: output.txtEnabled },
          { code: 'MD', name: 'Markdown', key: 'markdownEnabled', enabled: output.markdownEnabled },
        ] as const)
      : ([
          { code: 'SRT', name: '字幕文件', key: 'srtEnabled', enabled: output.srtEnabled },
          { code: 'TXT', name: '纯文本', key: 'txtEnabled', enabled: output.txtEnabled },
        ] as const);
  return (
    <section className="panel output-panel output-sheet" aria-labelledby="output-title">
      <div className="panel-heading">
        <div>
          <p className="step-label">04 / FILE OUTPUT</p>
          <h2 id="output-title">文件输出</h2>
        </div>
        <span className="output-location-chip">
          <span aria-hidden="true" /> {locationLabel}
        </span>
      </div>

      <div className="output-sheet-body">
        <section
          className="output-sheet-section output-destination"
          aria-labelledby="output-location-title"
        >
          <h3 className="output-section-title" id="output-location-title">
            <FolderOutput size={16} aria-hidden="true" /> 保存位置
          </h3>
          <div
            className="output-segments output-location-options"
            aria-label="文件输出策略"
            role="group"
          >
            {(
              [
                { value: 'source', label: '跟随' },
                { value: 'folders', label: '文件夹' },
                { value: 'custom', label: '自定义' },
              ] as const
            ).map((option) => (
              <button
                aria-pressed={locationMode === option.value}
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
          <p className={`output-location-description ${usesCustomLocation ? 'is-path' : ''}`}>
            {locationDescription}
          </p>
        </section>

        <section
          className="output-sheet-section output-file-types"
          aria-labelledby="output-format-title"
        >
          <div className="output-section-heading">
            <h3 className="output-section-title" id="output-format-title">
              <FileText size={16} aria-hidden="true" /> 文件格式
            </h3>
            <span className="output-section-note">可多选</span>
          </div>
          <div className="output-format-list">
            {formats.map((format) => (
              <label
                className={`output-format-option ${format.enabled ? 'is-selected' : ''}`}
                key={format.code}
              >
                <span className="output-format-code" aria-hidden="true">
                  {format.code}
                </span>
                <span className="output-format-name">{format.name}</span>
                <span className="output-format-mark" aria-hidden="true">
                  <Check size={12} strokeWidth={3} />
                </span>
                <input
                  aria-label={`生成 ${format.code === 'MD' ? 'Markdown' : format.code} 格式`}
                  checked={format.enabled}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setOutput({
                      [format.key]: enabled,
                      ...(format.key === 'txtEnabled'
                        ? { preserveSourceTxt: enabled ? output.preserveSourceTxt : false }
                        : {}),
                      ...(format.key === 'markdownEnabled'
                        ? {
                            preserveSourceMarkdown: enabled ? output.preserveSourceMarkdown : false,
                          }
                        : {}),
                    });
                  }}
                  type="checkbox"
                />
              </label>
            ))}
          </div>
          <p className="output-format-required">至少选择一种需要生成的文件格式。</p>
        </section>

        <section
          className="output-sheet-section output-rule-row"
          aria-labelledby="output-conflict-title"
        >
          <h3 className="output-section-title" id="output-conflict-title">
            <ShieldCheck size={16} aria-hidden="true" /> 同名文件
          </h3>
          <div
            className="output-segments output-conflict-options"
            aria-label="同名冲突策略"
            role="group"
          >
            {CONFLICT_POLICY_OPTIONS.map((option) => (
              <button
                aria-pressed={output.conflictPolicy === option.value}
                key={option.value}
                onClick={() => setOutput({ conflictPolicy: option.value })}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="output-rule-description">
            {CONFLICT_POLICY_SUMMARY[output.conflictPolicy]}。
          </p>
        </section>

        <section
          className="output-sheet-section output-rule-row"
          aria-labelledby="output-finish-title"
        >
          <h3 className="output-section-title" id="output-finish-title">
            <Power size={16} aria-hidden="true" /> 完成动作
          </h3>
          <div
            className="output-segments finish-action-options"
            aria-label="任务完成后的系统操作"
            role="group"
          >
            <button
              aria-pressed={finishAction === 'none'}
              onClick={() => setFinishAction('none')}
              type="button"
            >
              无操作
            </button>
            <button
              aria-pressed={finishAction === 'shutdown'}
              disabled={!powerCapabilities.shutdown}
              onClick={() => setFinishAction('shutdown')}
              type="button"
            >
              <Power size={13} /> 关机
            </button>
          </div>
          <p className="output-rule-description">
            {finishAction === 'shutdown' ? '本次任务全部完成后关机。' : '完成后保持工作台打开。'}
          </p>
        </section>
      </div>
    </section>
  );
}

import { Check, FileText, Sparkles } from 'lucide-react';

import { modelProfileSummary, PRESETS } from '../data/presets';
import { useWorkspace } from '../state/workspace';

export function PresetPanel() {
  const profileMode = useWorkspace((state) => state.profileMode);
  const selectedPresetId = useWorkspace((state) => state.selectedPresetId);
  const selectedModelId = useWorkspace((state) => state.selectedModelId);
  const selectProfile = useWorkspace((state) => state.selectProfile);
  const overrides = useWorkspace((state) => state.overrides);
  const setActiveView = useWorkspace((state) => state.setActiveView);
  const active = profileMode === 'transcript';
  const isCustom = active && Object.keys(overrides).length > 0;

  return (
    <section
      className={`panel preset-panel ${active ? 'is-active-profile' : ''}`}
      aria-labelledby="preset-title"
    >
      <div className="panel-heading">
        <div>
          <p className="step-label">02 / TRANSCRIPTION PROFILE</p>
          <h2 id="preset-title">文本识别模式</h2>
        </div>
        <span className={`mode-chip ${isCustom ? 'is-custom' : ''}`}>
          {isCustom ? (
            <Sparkles size={13} />
          ) : active ? (
            <Check size={13} />
          ) : (
            <FileText size={13} />
          )}
          {isCustom ? '派生自定义' : active ? '当前输出 TXT / MD' : '选择以启用'}
        </span>
      </div>

      <div className="preset-grid">
        {PRESETS.map((preset) => (
          <button
            className={`preset-card ${active && preset.id === selectedPresetId ? 'is-selected' : ''}`}
            key={preset.id}
            onClick={() => selectProfile('transcript', preset.id)}
            type="button"
          >
            <span className="language-mark">{preset.language === '中文' ? '中' : 'EN'}</span>
            <span>
              <strong>{preset.label}</strong>
              <small>{preset.summary}</small>
            </span>
            {active && preset.id === selectedPresetId && (
              <Check className="preset-check" size={16} />
            )}
          </button>
        ))}
      </div>

      <p className="preset-language-note">
        中／英文版本只决定断句、标点和文本排版；Worker 固定使用原声转录，不调用翻译任务。
        混合语言会先自动判断主语言，短时切换的保留能力取决于模型本身。
        <span>{modelProfileSummary(selectedModelId)}</span>
      </p>
      <div className="preset-parameter-link">
        <span>
          {isCustom ? '当前模型与模式使用自定义参数。' : '当前模型与模式使用正式默认参数。'}
        </span>
        <button className="secondary-button" onClick={() => setActiveView('models')} type="button">
          查看并修改模型参数
        </button>
      </div>
    </section>
  );
}

import { Captions, Check, Sparkles } from 'lucide-react';

import { SUBTITLE_PRESETS } from '../data/subtitlePresets';
import { useWorkspace } from '../state/workspace';
import { SubtitleParameterEditor } from './ProfileParameterEditor';

export function SubtitleProfilePanel() {
  const profileMode = useWorkspace((state) => state.profileMode);
  const selectedPresetId = useWorkspace((state) => state.selectedPresetId);
  const selectProfile = useWorkspace((state) => state.selectProfile);
  const overrides = useWorkspace((state) => state.overrides);
  const subtitleOverrides = useWorkspace((state) => state.subtitleOverrides);
  const restorePreset = useWorkspace((state) => state.restorePreset);
  const active = profileMode === 'subtitle';
  const isCustom =
    active && (Object.keys(overrides).length > 0 || Object.keys(subtitleOverrides).length > 0);

  return (
    <section
      className={`panel preset-panel subtitle-profile-panel ${active ? 'is-active-profile' : ''}`}
      aria-labelledby="subtitle-profile-title"
    >
      <div className="panel-heading">
        <div>
          <p className="step-label">03 / SRT SUBTITLE PROFILE</p>
          <h2 id="subtitle-profile-title">SRT 字幕识别与参数</h2>
        </div>
        <span className={`mode-chip subtitle-mode-chip ${isCustom ? 'is-custom' : ''}`}>
          {isCustom ? (
            <Sparkles size={13} />
          ) : active ? (
            <Check size={13} />
          ) : (
            <Captions size={13} />
          )}
          {isCustom ? '字幕自定义' : active ? '当前输出 SRT' : '选择以启用'}
        </span>
      </div>

      <div className="subtitle-timeline" aria-label="SRT 时间轴格式示意">
        <span>00:00:00,000</span>
        <div>
          <i />
          <i />
          <i />
        </div>
        <span>00:00:07,000</span>
      </div>

      <div className="preset-grid subtitle-preset-grid">
        {SUBTITLE_PRESETS.map((preset) => (
          <button
            className={`preset-card subtitle-preset-card ${active && preset.basePresetId === selectedPresetId ? 'is-selected' : ''}`}
            key={preset.id}
            onClick={() => selectProfile('subtitle', preset.basePresetId)}
            type="button"
          >
            <span className="language-mark">{preset.language === '中文' ? '中' : 'EN'}</span>
            <span>
              <strong>{preset.label}</strong>
              <small>{preset.summary}</small>
            </span>
            {active && preset.basePresetId === selectedPresetId && (
              <Check className="preset-check" size={16} />
            )}
          </button>
        ))}
      </div>

      {active && <SubtitleParameterEditor onRestore={restorePreset} />}
    </section>
  );
}

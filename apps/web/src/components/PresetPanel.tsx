import { WorkspaceEntryCard } from './WorkspaceEntryCard';
import { getModelLabel } from '../data/models';
import { Check, FileText, Sparkles, SlidersHorizontal } from 'lucide-react';

import { PRESETS } from '../data/presets';
import { useWorkspace } from '../state/workspace';

export function PresetPanel() {
  const openConfiguration = useWorkspace((state) => state.openConfiguration);
  const modelId = useWorkspace((state) => state.selectedModelId);
  const profileMode = useWorkspace((state) => state.profileMode);
  const selectedPresetId = useWorkspace((state) => state.selectedPresetId);
  const selectProfile = useWorkspace((state) => state.selectProfile);
  const overrides = useWorkspace((state) => state.overrides);
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
            aria-pressed={active && preset.id === selectedPresetId}
            className={`selection-card preset-card ${active && preset.id === selectedPresetId ? 'is-selected' : ''}`}
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
      <WorkspaceEntryCard
        aria-label="前往参数调节"
        icon={<SlidersHorizontal size={15} />}
        label="模型与参数"
        title="调整当前识别参数"
        description={`${getModelLabel(modelId)} · ${Object.keys(overrides).length ? `${Object.keys(overrides).length} 项自定义` : '默认参数'} · 点击进入参数调节`}
        onClick={() => openConfiguration('parameters')}
      />
    </section>
  );
}

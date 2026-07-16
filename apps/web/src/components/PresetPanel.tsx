import { Check, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react';

import type { EditableParameters } from '../contracts/desktop';
import { PRESETS } from '../data/presets';
import { useWorkspace } from '../state/workspace';

const NUMBER_FIELDS: Array<{
  key: keyof Pick<
    EditableParameters,
    'beam_size' | 'best_of' | 'patience' | 'temperature' | 'no_speech_threshold'
  >;
  label: string;
  min: number;
  max: number;
  step: number;
  help: string;
  risk: string;
}> = [
  {
    key: 'beam_size',
    label: 'Beam size',
    min: 1,
    max: 20,
    step: 1,
    help: '增加候选搜索宽度，通常更慢并占用更多显存。',
    risk: '性能',
  },
  {
    key: 'best_of',
    label: 'Best of',
    min: 1,
    max: 20,
    step: 1,
    help: '温度采样候选数；temperature 为 0 时通常影响有限。',
    risk: '性能',
  },
  {
    key: 'patience',
    label: 'Patience',
    min: 0,
    max: 5,
    step: 0.1,
    help: '放宽 beam search 提前停止条件。',
    risk: '解码',
  },
  {
    key: 'temperature',
    label: 'Temperature',
    min: 0,
    max: 1,
    step: 0.1,
    help: '提高随机性；稳定转录建议保持 preset 原值。',
    risk: '高风险',
  },
  {
    key: 'no_speech_threshold',
    label: 'No speech',
    min: 0,
    max: 1,
    step: 0.05,
    help: '提高后更容易把低置信片段判定为无语音。',
    risk: '召回率',
  },
];

export function PresetPanel() {
  const selectedPresetId = useWorkspace((state) => state.selectedPresetId);
  const selectPreset = useWorkspace((state) => state.selectPreset);
  const parameters = useWorkspace((state) => state.parameters);
  const overrides = useWorkspace((state) => state.overrides);
  const setParameter = useWorkspace((state) => state.setParameter);
  const restorePreset = useWorkspace((state) => state.restorePreset);
  const isCustom = Object.keys(overrides).length > 0;

  return (
    <section className="panel preset-panel" aria-labelledby="preset-title">
      <div className="panel-heading">
        <div>
          <p className="step-label">02 · PROFILE</p>
          <h2 id="preset-title">模式与参数</h2>
        </div>
        <span className={`mode-chip ${isCustom ? 'is-custom' : ''}`}>
          {isCustom ? <Sparkles size={13} /> : <Check size={13} />}
          {isCustom ? '派生自定义' : 'Preset 原值'}
        </span>
      </div>

      <div className="preset-grid">
        {PRESETS.map((preset) => (
          <button
            className={`preset-card ${preset.id === selectedPresetId ? 'is-selected' : ''}`}
            key={preset.id}
            onClick={() => selectPreset(preset.id)}
            type="button"
          >
            <span className="language-mark">{preset.language === '中文' ? '中' : 'EN'}</span>
            <span>
              <strong>{preset.label}</strong>
              <small>{preset.summary}</small>
            </span>
            {preset.id === selectedPresetId && <Check className="preset-check" size={16} />}
          </button>
        ))}
      </div>

      <div className="parameter-heading">
        <div>
          <SlidersHorizontal size={17} />
          <strong>安全参数</strong>
          <span>任务入队时冻结快照</span>
        </div>
        {isCustom && (
          <button className="quiet-button" onClick={restorePreset} type="button">
            <RotateCcw size={14} /> 恢复 preset
          </button>
        )}
      </div>

      <div className="parameter-grid">
        {NUMBER_FIELDS.map((field) => (
          <label className="parameter-field" key={field.key}>
            <span>
              {field.label} <em>{field.risk}</em>
            </span>
            <input
              aria-label={field.label}
              max={field.max}
              min={field.min}
              onChange={(event) => setParameter(field.key, Number(event.target.value))}
              step={field.step}
              type="number"
              value={parameters[field.key]}
            />
            <small>{field.help}</small>
          </label>
        ))}
        <label className="toggle-field">
          <span>
            <strong>使用前文上下文</strong>
            <small>condition_on_previous_text</small>
          </span>
          <input
            checked={parameters.condition_on_previous_text}
            onChange={(event) => setParameter('condition_on_previous_text', event.target.checked)}
            type="checkbox"
          />
        </label>
      </div>
    </section>
  );
}

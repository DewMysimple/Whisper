import { RotateCcw, SlidersHorizontal } from 'lucide-react';

import type { SubtitleParameters } from '../contracts/desktop';
import { useWorkspace } from '../state/workspace';

const SUBTITLE_FIELDS: Array<{
  key: keyof SubtitleParameters;
  label: string;
  min: number;
  max: number;
  step: number;
  help: string;
  unit: string;
}> = [
  {
    key: 'max_characters_per_line',
    label: '每行最多字符',
    min: 8,
    max: 84,
    step: 1,
    help: '超过后优先在标点或空格处换行。',
    unit: '字符',
  },
  {
    key: 'max_lines_per_cue',
    label: '每条最多行数',
    min: 1,
    max: 3,
    step: 1,
    help: '控制单条字幕在画面中的最大行数。',
    unit: '行',
  },
  {
    key: 'min_cue_duration_ms',
    label: '最短显示时长',
    min: 250,
    max: 5000,
    step: 50,
    help: '用于识别过短字幕并辅助排版。',
    unit: '毫秒',
  },
  {
    key: 'max_cue_duration_ms',
    label: '最长显示时长',
    min: 1000,
    max: 15000,
    step: 100,
    help: '结合阅读速度决定长句拆分。',
    unit: '毫秒',
  },
  {
    key: 'max_characters_per_second',
    label: '最大阅读速度',
    min: 5,
    max: 40,
    step: 1,
    help: '限制每秒出现的字符数量。',
    unit: '字符/秒',
  },
  {
    key: 'cue_gap_ms',
    label: '字幕间隔',
    min: 0,
    max: 1000,
    step: 10,
    help: '相邻字幕之间保留的最小空隙。',
    unit: '毫秒',
  },
];

export function SubtitleParameterEditor({ onRestore }: { onRestore: () => void }) {
  const parameters = useWorkspace((state) => state.subtitleParameters);
  const overrides = useWorkspace((state) => state.subtitleOverrides);
  const setParameter = useWorkspace((state) => state.setSubtitleParameter);
  const isCustom = Object.keys(overrides).length > 0;

  return (
    <>
      <div className="parameter-heading subtitle-parameter-heading">
        <div className="parameter-heading-copy">
          <SlidersHorizontal size={17} />
          <strong>SRT 排版参数</strong>
        </div>
        {isCustom && (
          <button className="quiet-button" onClick={onRestore} type="button">
            <RotateCcw size={14} /> 恢复字幕 preset
          </button>
        )}
      </div>
      <div className="parameter-grid subtitle-parameter-grid">
        {SUBTITLE_FIELDS.map((field) => (
          <label className="parameter-field subtitle-parameter-field" key={field.key}>
            <span className="parameter-field-label">
              <span>{field.label}</span>
              <em>{field.unit}</em>
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
      </div>
    </>
  );
}

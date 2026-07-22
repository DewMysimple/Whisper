import { RotateCcw, SlidersHorizontal } from 'lucide-react';

import type { EditableParameters, SubtitleParameters } from '../contracts/desktop';
import { useWorkspace } from '../state/workspace';
import { HelpTip } from './HelpTip';

const INFERENCE_FIELDS: Array<{
  key: Exclude<keyof EditableParameters, 'condition_on_previous_text'>;
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
    help: '候选搜索宽度；越高通常越慢。',
    risk: '性能',
  },
  {
    key: 'best_of',
    label: 'Best of',
    min: 1,
    max: 20,
    step: 1,
    help: '非零温度下的采样候选数。',
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
    key: 'length_penalty',
    label: 'Length penalty',
    min: 0,
    max: 2,
    step: 0.1,
    help: '调整长短候选的评分倾向。',
    risk: '文本',
  },
  {
    key: 'temperature',
    label: 'Temperature',
    min: 0,
    max: 1,
    step: 0.1,
    help: '提高随机性；稳定转录建议保持原值。',
    risk: '高风险',
  },
  {
    key: 'compression_ratio_threshold',
    label: 'Compression ratio',
    min: 0,
    max: 10,
    step: 0.1,
    help: '超过阈值时判定文本重复异常。',
    risk: '回退',
  },
  {
    key: 'log_prob_threshold',
    label: 'Log probability',
    min: -10,
    max: 0,
    step: 0.1,
    help: '低于阈值时判定解码置信不足。',
    risk: '回退',
  },
  {
    key: 'no_speech_threshold',
    label: 'No speech',
    min: 0,
    max: 1,
    step: 0.05,
    help: '提高后更容易忽略低置信语音。',
    risk: '召回率',
  },
  {
    key: 'min_silence_duration_ms',
    label: 'VAD 最短静音',
    min: 0,
    max: 10000,
    step: 50,
    help: '决定 VAD 切分语音段所需静音长度。',
    risk: '毫秒',
  },
];

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

export function InferenceParameterEditor({ onRestore }: { onRestore: () => void }) {
  const parameters = useWorkspace((state) => state.parameters);
  const overrides = useWorkspace((state) => state.overrides);
  const setParameter = useWorkspace((state) => state.setParameter);
  const isCustom = Object.keys(overrides).length > 0;

  return (
    <>
      <div className="parameter-heading">
        <div className="parameter-heading-copy">
          <SlidersHorizontal size={17} />
          <strong>识别参数</strong>
          <HelpTip id="inference-parameter-help" label="查看识别参数说明">
            所有可由正式 Worker 安全覆盖的推理参数都会在任务入队时冻结。
          </HelpTip>
        </div>
        {isCustom && (
          <button className="quiet-button" onClick={onRestore} type="button">
            <RotateCcw size={14} /> 恢复 preset
          </button>
        )}
      </div>
      <div className="parameter-grid inference-parameter-grid">
        {INFERENCE_FIELDS.map((field) => (
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
    </>
  );
}

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
          <HelpTip id="subtitle-parameter-help" label="查看 SRT 排版参数说明">
            参数只控制字幕切分、换行和时间轴排版，不改变模型识别内容。
          </HelpTip>
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
            <span>
              {field.label} <em>{field.unit}</em>
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

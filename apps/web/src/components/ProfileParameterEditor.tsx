import { ArrowLeft, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react';

import type { EditableParameters, SubtitleParameters } from '../contracts/desktop';
import { MODEL_PRESENTATIONS } from '../data/models';
import { PRESETS, modelProfileSummary } from '../data/presets';
import { useWorkspace } from '../state/workspace';
import { HelpTip } from './HelpTip';

type NumericParameterKey = {
  [K in keyof EditableParameters]: EditableParameters[K] extends number ? K : never;
}[keyof EditableParameters];

const BASIC_FIELDS: Array<{
  key: NumericParameterKey;
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

const ADVANCED_FIELDS: Array<{
  key: NumericParameterKey;
  label: string;
  min: number;
  max: number;
  step: number;
  help: string;
  risk: string;
}> = [
  {
    key: 'repetition_penalty',
    label: 'Repetition penalty',
    min: 1,
    max: 2,
    step: 0.05,
    help: '大于 1 时降低重复 token 的分数；过高可能漏字。',
    risk: '重复控制',
  },
  {
    key: 'no_repeat_ngram_size',
    label: 'No-repeat N-gram',
    min: 0,
    max: 10,
    step: 1,
    help: '禁止重复指定长度的词组；0 表示关闭。',
    risk: '高风险',
  },
  {
    key: 'prompt_reset_on_temperature',
    label: 'Prompt reset temperature',
    min: 0,
    max: 1,
    step: 0.1,
    help: '使用前文上下文时，达到该温度后清空前文提示。',
    risk: '上下文',
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

function NumericFields({ fields }: { fields: typeof BASIC_FIELDS }) {
  const parameters = useWorkspace((state) => state.parameters);
  const setParameter = useWorkspace((state) => state.setParameter);
  return (
    <div className="parameter-grid inference-parameter-grid">
      {fields.map((field) => (
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
    </div>
  );
}

export function InferenceParameterEditor() {
  const parameters = useWorkspace((state) => state.parameters);
  const overrides = useWorkspace((state) => state.overrides);
  const selectedModelId = useWorkspace((state) => state.selectedModelId);
  const selectedPresetId = useWorkspace((state) => state.selectedPresetId);
  const setParameter = useWorkspace((state) => state.setParameter);
  const setTemperatureMode = useWorkspace((state) => state.setTemperatureMode);
  const recognitionStrategy = useWorkspace((state) => state.recognitionStrategy);
  const setRecognitionStrategy = useWorkspace((state) => state.setRecognitionStrategy);
  const restorePreset = useWorkspace((state) => state.restorePreset);
  const setActiveView = useWorkspace((state) => state.setActiveView);
  const chineseMode = selectedPresetId === 'cn' || selectedPresetId === 'cn2';
  const isCustom = Object.keys(overrides).length > 0 || recognitionStrategy !== 'stable_primary';
  const temperatureMode = Object.prototype.hasOwnProperty.call(overrides, 'temperature')
    ? 'fixed'
    : 'model';
  const preset = PRESETS.find((item) => item.id === selectedPresetId)!;
  const englishMode = selectedPresetId === 'en_v1' || selectedPresetId === 'en_v2';
  const translationAvailable = englishMode && selectedModelId === 'large-v3';
  const hotwordCount = parameters.hotwords
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean).length;

  return (
    <section
      className="panel inference-parameter-editor model-parameter-panel"
      aria-labelledby="model-parameter-title"
    >
      <div className="parameter-heading">
        <div className="parameter-heading-copy">
          <SlidersHorizontal size={17} />
          <div>
            <p className="step-label">MODEL × PRESET PROFILE</p>
            <h2 id="model-parameter-title">当前模型参数</h2>
          </div>
          <HelpTip id="inference-parameter-help" label="查看识别参数说明">
            参数按模型与识别模式分别保存，并在任务入队时冻结。修改不会影响已经运行或排队的任务。
          </HelpTip>
        </div>
        <div className="parameter-heading-actions">
          <button className="quiet-button" onClick={() => setActiveView('workspace')} type="button">
            <ArrowLeft size={14} /> 更换识别模式
          </button>
          {isCustom && (
            <button className="quiet-button" onClick={restorePreset} type="button">
              <RotateCcw size={14} /> 恢复当前组合
            </button>
          )}
        </div>
      </div>

      <div className="parameter-profile-identity">
        <div>
          <small>推理模型</small>
          <strong>{MODEL_PRESENTATIONS[selectedModelId].label}</strong>
        </div>
        <div>
          <small>识别模式</small>
          <strong>{preset.label}</strong>
        </div>
        <div>
          <small>参数状态</small>
          <strong>{isCustom ? '派生自定义' : '正式默认'}</strong>
        </div>
        <span className={isCustom ? 'is-custom' : ''}>
          <Sparkles size={14} /> {modelProfileSummary(selectedModelId)}
        </span>
      </div>

      <div className="parameter-section">
        <div className="parameter-section-heading">
          <div>
            <strong>任务与基础解码</strong>
            <small>控制本地模型如何生成候选文本。</small>
          </div>
        </div>
        {chineseMode && (
          <div className="recognition-strategy-control">
            <div>
              <strong>识别策略</strong>
              <small>增强模式会增加耗时，只在证据充分时改写正文。</small>
            </div>
            <div
              className="parameter-segmented recognition-strategy-segmented"
              role="group"
              aria-label="识别策略"
            >
              <button
                aria-pressed={recognitionStrategy === 'stable_primary'}
                className={recognitionStrategy === 'stable_primary' ? 'is-active' : ''}
                onClick={() => setRecognitionStrategy('stable_primary')}
                type="button"
              >
                稳定主语言
              </button>
              <button
                aria-pressed={recognitionStrategy === 'mixed_zh_en'}
                className={recognitionStrategy === 'mixed_zh_en' ? 'is-active' : ''}
                onClick={() => setRecognitionStrategy('mixed_zh_en')}
                type="button"
              >
                复杂中英混合
              </button>
              <button
                aria-pressed={recognitionStrategy === 'zh_detail_review'}
                className={recognitionStrategy === 'zh_detail_review' ? 'is-active' : ''}
                onClick={() => setRecognitionStrategy('zh_detail_review')}
                type="button"
              >
                中文细节增强
              </button>
            </div>
            <small>
              {recognitionStrategy === 'mixed_zh_en'
                ? '先完成稳定中文识别，再对短语音块做本地语言侦测与英文复识别；不确定候选只进入复核记录。'
                : recognitionStrategy === 'zh_detail_review'
                  ? '耗时显著增加；Hotwords 仅作识别提示。局部候选不确定时不会写入正文，只进入复核记录。'
                  : '整段使用稳定主语言策略，保持当前速度和既有结果。'}
            </small>
          </div>
        )}
        <div className="parameter-task-row">
          <label className="parameter-field">
            <span>
              任务类型{' '}
              <em>
                {translationAvailable
                  ? '本地执行'
                  : selectedModelId === 'large-v3-turbo'
                    ? 'Turbo 仅转录'
                    : '中文模式锁定'}
              </em>
            </span>
            <select
              aria-label="任务类型"
              disabled={!translationAvailable}
              onChange={(event) =>
                setParameter('task', event.target.value as EditableParameters['task'])
              }
              value={parameters.task}
            >
              <option value="transcribe">原声转录</option>
              <option value="translate">翻译为英语</option>
            </select>
            <small>
              {translationAvailable
                ? 'Large V3 在本机执行语音翻译，只输出英语，不调用联网服务。'
                : selectedModelId === 'large-v3-turbo'
                  ? '官方 Turbo 模型未针对翻译任务训练，即使请求 translate 也会返回原语言，因此此处固定为原声转录。'
                  : '中文模式固定保留原始语音语言。'}
            </small>
          </label>
          <div className="temperature-control">
            <span>
              Temperature <em>{temperatureMode === 'model' ? '模型回退' : '固定值'}</em>
            </span>
            <div className="parameter-segmented" role="group" aria-label="温度策略">
              <button
                aria-pressed={temperatureMode === 'model'}
                className={temperatureMode === 'model' ? 'is-active' : ''}
                onClick={() => setTemperatureMode('model')}
                type="button"
              >
                模型回退
              </button>
              <button
                aria-pressed={temperatureMode === 'fixed'}
                className={temperatureMode === 'fixed' ? 'is-active' : ''}
                onClick={() => setTemperatureMode('fixed')}
                type="button"
              >
                固定温度
              </button>
            </div>
            <input
              aria-label="固定温度"
              disabled={temperatureMode === 'model'}
              max={1}
              min={0}
              onChange={(event) => setParameter('temperature', Number(event.target.value))}
              step={0.1}
              type="number"
              value={parameters.temperature}
            />
            <small>
              {temperatureMode === 'model'
                ? selectedModelId === 'large-v3'
                  ? 'Large V3 使用 0–1.0 完整回退阶梯。'
                  : 'Large V3 Turbo 使用 0–0.6 稳定回退阶梯。'
                : '固定值会替代整条模型温度回退阶梯。'}
            </small>
          </div>
        </div>
        <NumericFields fields={BASIC_FIELDS} />
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

      <details className="parameter-advanced">
        <summary>
          <span>
            <strong>重复控制与上下文</strong>
            <small>高级参数 · 默认折叠</small>
          </span>
        </summary>
        <NumericFields fields={ADVANCED_FIELDS} />
      </details>

      <div className="parameter-section parameter-guidance">
        <div className="parameter-section-heading">
          <div>
            <strong>提示引导</strong>
            <small>只提供上下文线索，不保证模型按指定词语输出。</small>
          </div>
        </div>
        <div className="parameter-text-grid">
          <label className="parameter-field">
            <span>
              初始提示词 <em>{Array.from(parameters.initial_prompt).length} / 4000</em>
            </span>
            <textarea
              maxLength={4000}
              onChange={(event) => setParameter('initial_prompt', event.target.value)}
              placeholder="例如：本期讨论 CTranslate2 与 WebView2 的部署方式。"
              rows={5}
              value={parameters.initial_prompt}
            />
            <small>仅提示第一个解码窗口；它不是系统指令。</small>
          </label>
          <label className="parameter-field">
            <span>
              术语提示（Hotwords）{' '}
              <em>
                {hotwordCount > 0 ? `已启用 ${hotwordCount} 个词条 · ` : ''}
                {Array.from(parameters.hotwords).length} / 4000
              </em>
            </span>
            <textarea
              maxLength={4000}
              onChange={(event) => setParameter('hotwords', event.target.value)}
              placeholder={'WhisperSubtitle\nCTranslate2\nWebView2'}
              rows={5}
              value={parameters.hotwords}
            />
            <small>可按行填写专名；属于识别提示，不执行强制替换。</small>
          </label>
        </div>
      </div>

      <div className="parameter-readonly" aria-label="模型校准只读参数">
        <strong>第 26 次校准策略</strong>
        <span>主语言自动检测</span>
        <span>检测窗口 5</span>
        <span>检测阈值 1.0</span>
        <span>逐窗口多语言关闭</span>
        <span>VAD 开启</span>
        <span>字幕任务使用词级时间戳</span>
      </div>
    </section>
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

import type { EditableParameters } from '../contracts/desktop';

export type ParameterKey = keyof EditableParameters;
export const PARAMETER_GROUPS: Array<{ title: string; description: string; keys: ParameterKey[] }> =
  [
    {
      title: '语言与任务',
      description: '识别语言与输出任务；识别模式继续决定文本排版。',
      keys: [
        'task',
        'language',
        'multilingual',
        'language_detection_threshold',
        'language_detection_segments',
      ],
    },
    {
      title: '解码与采样',
      description: '平衡识别质量、速度与重复控制。温度为 0 时使用束搜索，非零时使用采样候选。',
      keys: [
        'beam_size',
        'best_of',
        'patience',
        'length_penalty',
        'temperature',
        'repetition_penalty',
        'no_repeat_ngram_size',
        'compression_ratio_threshold',
        'log_prob_threshold',
        'no_speech_threshold',
        'suppress_blank',
        'suppress_tokens',
        'max_new_tokens',
      ],
    },
    {
      title: '上下文与提示词',
      description: '提示词会影响识别倾向，请使用与实际音频相关的内容。',
      keys: [
        'condition_on_previous_text',
        'prompt_reset_on_temperature',
        'initial_prompt',
        'hotwords',
        'prefix',
      ],
    },
    {
      title: '语音检测与分段',
      description: '先检测语音片段，再送入识别模型。关闭语音检测时，VAD 分段参数不参与处理。',
      keys: [
        'vad_filter',
        'vad_threshold',
        'vad_neg_threshold',
        'min_speech_duration_ms',
        'max_speech_duration_s',
        'min_silence_duration_ms',
        'speech_pad_ms',
        'chunk_length',
      ],
    },
    {
      title: '时间戳与标点',
      description: 'SRT 输出始终启用真实词级时间戳；下列开关控制 TXT / MD 的额外词级对齐。',
      keys: [
        'word_timestamps',
        'max_initial_timestamp',
        'prepend_punctuations',
        'append_punctuations',
        'hallucination_silence_threshold',
      ],
    },
  ];

export const PARAMETER_COPY: Record<
  ParameterKey,
  { label: string; help: string; nullLabel?: string }
> = {
  task: { label: '任务类型', help: '翻译为英语需要支持翻译的模型，并选择英文识别模式。' },
  language: {
    label: '识别语言',
    help: '自动检测或指定语言代码，例如 zh、en、ja、yue。',
    nullLabel: '自动检测',
  },
  multilingual: {
    label: '逐窗口语言检测',
    help: '每个窗口独立判断语言。混合语音可能产生语言跳变，默认关闭。',
  },
  language_detection_threshold: {
    label: '语言检测置信度',
    help: '达到该概率后提前结束检测；1 表示检查所有指定窗口。',
  },
  language_detection_segments: { label: '语言检测窗口数', help: '用于语言检测的音频窗口上限。' },
  beam_size: { label: '束搜索宽度', help: '更大可能提高精度，也会增加处理时间。' },
  best_of: { label: '采样候选数', help: '温度大于 0 时保留的候选数。' },
  patience: { label: '搜索耐心系数', help: '增大后搜索更多候选，可能更慢。' },
  length_penalty: { label: '长度惩罚', help: '调整候选序列的长度偏好。' },
  temperature: {
    label: '温度与回退序列',
    help: '单个数值固定温度；逗号分隔的递增序列在质量检查失败时逐级重试，例如 0, 0.2, 0.4, 0.6。',
  },
  repetition_penalty: { label: '重复惩罚', help: '1 不惩罚；增大后降低重复 token 的概率。' },
  no_repeat_ngram_size: {
    label: '禁止重复片段长度',
    help: '禁止同长度的 token 组合重复；0 表示关闭。',
  },
  compression_ratio_threshold: {
    label: '压缩比阈值',
    help: '超过阈值的重复文本触发温度回退。',
    nullLabel: '关闭检查',
  },
  log_prob_threshold: {
    label: '平均对数概率阈值',
    help: '低于阈值视为低置信度，可触发温度回退。',
    nullLabel: '关闭检查',
  },
  no_speech_threshold: {
    label: '无语音概率阈值',
    help: '结合对数概率判断静音片段。',
    nullLabel: '关闭检查',
  },
  condition_on_previous_text: {
    label: '沿用前文上下文',
    help: '改善前后连贯性；关闭可减少重复循环。',
  },
  prompt_reset_on_temperature: {
    label: '上下文重置温度',
    help: '回退温度超过该值时清除前文；仅沿用上下文时有效。',
  },
  initial_prompt: {
    label: '初始提示词',
    help: '首个窗口的风格、术语与背景提示，最多 4000 字符。',
    nullLabel: '不使用提示词',
  },
  hotwords: {
    label: '术语提示',
    help: '人名、术语可分行输入；设置首段前缀时，模型会忽略术语提示。',
    nullLabel: '不使用术语提示',
  },
  prefix: {
    label: '首段前缀',
    help: '作为首个窗口的起始文字，可能直接影响输出内容。',
    nullLabel: '不使用前缀',
  },
  suppress_blank: { label: '抑制空白输出', help: '在解码起始处抑制空白候选。' },
  suppress_tokens: {
    label: '抑制 token',
    help: '逗号分隔的 token ID；-1 使用模型默认非语音 token 集合；留空表示不抑制。',
  },
  vad_filter: { label: '启用语音活动检测', help: '过滤静音并按语音片段处理。' },
  vad_threshold: { label: '语音起点阈值', help: '高于此概率视为语音。' },
  vad_neg_threshold: {
    label: '语音结束阈值',
    help: '低于此概率视为静音；自动值跟随起点阈值。',
    nullLabel: '自动跟随起点',
  },
  min_speech_duration_ms: { label: '最短语音片段（毫秒）', help: '短于该值的语音片段会被过滤。' },
  max_speech_duration_s: {
    label: '最长语音片段（秒）',
    help: '超出后分段；999999 沿用预设的近似无限长度。',
  },
  min_silence_duration_ms: {
    label: '分段静音长度（毫秒）',
    help: '连续静音达到该长度后分割语音。',
  },
  speech_pad_ms: {
    label: '语音两侧留白（毫秒）',
    help: '为检测到的语音保留首尾音频，避免切掉边缘发音。',
  },
  max_new_tokens: {
    label: '每窗口最大新 token 数',
    help: '降低上限可能截断文本；提示词也占用模型上下文。',
    nullLabel: '模型默认上限',
  },
  chunk_length: { label: '识别窗口长度（秒）', help: '每次解码使用的音频窗口，默认 30 秒。' },
  word_timestamps: {
    label: '词级时间戳',
    help: '为每个词计算对齐时间，会增加处理量。SRT 输出始终启用。',
  },
  max_initial_timestamp: { label: '首个时间戳上限（秒）', help: '首段允许的最晚起点。' },
  prepend_punctuations: {
    label: '合并到后词的标点',
    help: '词级对齐时，将这些前置标点合并到后一个词。',
  },
  append_punctuations: {
    label: '合并到前词的标点',
    help: '词级对齐时，将这些后置标点合并到前一个词。',
  },
  hallucination_silence_threshold: {
    label: '幻觉静音跳过阈值（秒）',
    help: '词级时间戳启用时，遇到疑似幻觉跳过较长静音。',
    nullLabel: '关闭跳过',
  },
};

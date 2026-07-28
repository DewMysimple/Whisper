import type { ModelId, PresetDefinition, TranscriptionTask } from '../contracts/desktop';

export const PRESETS: PresetDefinition[] = [
  {
    id: 'cn',
    label: '中文转录',
    language: '中文',
    summary: '自动识别主语言 · 中文断句与标点',
    parameters: {
      task: 'transcribe',
      beam_size: 5,
      best_of: 5,
      patience: 1.5,
      length_penalty: 1,
      temperature: 0,
      repetition_penalty: 1,
      no_repeat_ngram_size: 0,
      compression_ratio_threshold: 2.4,
      log_prob_threshold: -1,
      no_speech_threshold: 0.6,
      condition_on_previous_text: true,
      prompt_reset_on_temperature: 0.5,
      initial_prompt: '',
      hotwords: '',
      min_silence_duration_ms: 300,
    },
  },
  {
    id: 'cn2',
    label: '中文防幻觉',
    language: '中文',
    summary: '自动识别主语言 · 中文排版与循环清理',
    parameters: {
      task: 'transcribe',
      beam_size: 5,
      best_of: 5,
      patience: 1.5,
      length_penalty: 1,
      temperature: 0,
      repetition_penalty: 1,
      no_repeat_ngram_size: 0,
      compression_ratio_threshold: 2,
      log_prob_threshold: -1.5,
      no_speech_threshold: 0.8,
      condition_on_previous_text: false,
      prompt_reset_on_temperature: 0.5,
      initial_prompt: '',
      hotwords: '',
      min_silence_duration_ms: 500,
    },
  },
  {
    id: 'en_v1',
    label: '英文转录',
    language: 'English',
    summary: 'Auto-detect primary language · English formatting',
    parameters: {
      task: 'transcribe',
      beam_size: 5,
      best_of: 5,
      patience: 1.5,
      length_penalty: 1,
      temperature: 0,
      repetition_penalty: 1,
      no_repeat_ngram_size: 0,
      compression_ratio_threshold: 2.4,
      log_prob_threshold: -1,
      no_speech_threshold: 0.6,
      condition_on_previous_text: true,
      prompt_reset_on_temperature: 0.5,
      initial_prompt: '',
      hotwords: '',
      min_silence_duration_ms: 300,
    },
  },
  {
    id: 'en_v2',
    label: '英文防幻觉',
    language: 'English',
    summary: 'Auto-detect primary language · English anti-loop cleanup',
    parameters: {
      task: 'transcribe',
      beam_size: 5,
      best_of: 5,
      patience: 1.5,
      length_penalty: 1,
      temperature: 0,
      repetition_penalty: 1,
      no_repeat_ngram_size: 0,
      compression_ratio_threshold: 2,
      log_prob_threshold: -1.5,
      no_speech_threshold: 0.8,
      condition_on_previous_text: false,
      prompt_reset_on_temperature: 0.5,
      initial_prompt: '',
      hotwords: '',
      min_silence_duration_ms: 500,
    },
  },
];

export function getPreset(
  id: PresetDefinition['id'],
  modelId: ModelId = 'large-v3-turbo',
): PresetDefinition {
  const preset = PRESETS.find((item) => item.id === id);
  if (preset === undefined) throw new Error(`Unknown preset: ${id}`);
  if (
    (modelId === 'large-v3' || modelId === 'large-v3-turbo') &&
    (id === 'cn2' || id === 'en_v2')
  ) {
    return {
      ...preset,
      parameters: {
        ...preset.parameters,
        log_prob_threshold: -1,
        no_speech_threshold: 0.6,
      },
    };
  }
  return preset;
}

export function modelProfileSummary(modelId: ModelId): string {
  if (modelId === 'large-v3') return 'Large-V3 质量优先 · 完整温度回退 0–1.0';
  if (modelId === 'large-v3-turbo') return 'Large-V3-Turbo 稳定优先 · 温度回退上限 0.6';
  return '旧版模型兼容参数';
}

export function transcriptionTaskLabel(task: TranscriptionTask | undefined): string {
  return task === 'translate' ? '翻译为英语' : '原声转录';
}

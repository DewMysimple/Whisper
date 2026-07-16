import type { PresetDefinition } from '../contracts/desktop';

export const PRESETS: PresetDefinition[] = [
  {
    id: 'cn',
    label: '中文转录',
    language: '中文',
    summary: '稳健解码，适合课程与会议',
    parameters: {
      beam_size: 5,
      best_of: 5,
      patience: 1.5,
      temperature: 0,
      no_speech_threshold: 0.6,
      condition_on_previous_text: true,
    },
  },
  {
    id: 'cn2',
    label: '中文防幻觉',
    language: '中文',
    summary: '关闭上下文并收紧防幻觉阈值',
    parameters: {
      beam_size: 5,
      best_of: 5,
      patience: 1.5,
      temperature: 0,
      no_speech_threshold: 0.8,
      condition_on_previous_text: false,
    },
  },
  {
    id: 'en_v1',
    label: '英文标准版',
    language: 'English',
    summary: 'Balanced English transcription',
    parameters: {
      beam_size: 5,
      best_of: 5,
      patience: 1.5,
      temperature: 0,
      no_speech_threshold: 0.6,
      condition_on_previous_text: true,
    },
  },
  {
    id: 'en_v2',
    label: '英文防幻觉',
    language: 'English',
    summary: 'Tighter thresholds without previous context',
    parameters: {
      beam_size: 5,
      best_of: 5,
      patience: 1.5,
      temperature: 0,
      no_speech_threshold: 0.8,
      condition_on_previous_text: false,
    },
  },
];

export function getPreset(id: PresetDefinition['id']): PresetDefinition {
  const preset = PRESETS.find((item) => item.id === id);
  if (preset === undefined) throw new Error(`Unknown preset: ${id}`);
  return preset;
}

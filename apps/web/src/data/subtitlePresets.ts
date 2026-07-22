import type { PresetId, SubtitleParameters } from '../contracts/desktop';

export interface SubtitlePresetDefinition {
  id: `srt_${PresetId}`;
  basePresetId: PresetId;
  label: string;
  language: '中文' | 'English';
  summary: string;
  subtitleParameters: SubtitleParameters;
}

const COMMON_SUBTITLE_PARAMETERS = {
  max_lines_per_cue: 1,
  min_cue_duration_ms: 800,
  max_cue_duration_ms: 7000,
  max_characters_per_second: 20,
  cue_gap_ms: 80,
} as const;

export const SUBTITLE_PRESETS: SubtitlePresetDefinition[] = [
  {
    id: 'srt_cn',
    basePresetId: 'cn',
    label: '中文转录',
    language: '中文',
    summary: '单行字幕 · 每行 18 字',
    subtitleParameters: { ...COMMON_SUBTITLE_PARAMETERS, max_characters_per_line: 18 },
  },
  {
    id: 'srt_cn2',
    basePresetId: 'cn2',
    label: '中文防幻觉',
    language: '中文',
    summary: '关闭上下文并清理重复字幕',
    subtitleParameters: { ...COMMON_SUBTITLE_PARAMETERS, max_characters_per_line: 18 },
  },
  {
    id: 'srt_en_v1',
    basePresetId: 'en_v1',
    label: '英文转录',
    language: 'English',
    summary: 'One line · 42 characters',
    subtitleParameters: { ...COMMON_SUBTITLE_PARAMETERS, max_characters_per_line: 42 },
  },
  {
    id: 'srt_en_v2',
    basePresetId: 'en_v2',
    label: '英文防幻觉',
    language: 'English',
    summary: 'Tighter thresholds and repeat cleanup',
    subtitleParameters: { ...COMMON_SUBTITLE_PARAMETERS, max_characters_per_line: 42 },
  },
];

export function getSubtitlePreset(basePresetId: PresetId): SubtitlePresetDefinition {
  const preset = SUBTITLE_PRESETS.find((item) => item.basePresetId === basePresetId);
  if (preset === undefined) throw new Error(`Unknown subtitle preset: ${basePresetId}`);
  return preset;
}

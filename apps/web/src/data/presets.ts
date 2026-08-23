import type { ModelId, PresetDefinition, TranscriptionTask } from '../contracts/desktop';
import { GENERATED_MODEL_PROFILES, GENERATED_PRESET_PARAMETERS } from './presetCatalog.generated';

type PresetPresentation = Omit<PresetDefinition, 'parameters'>;

// Labels and summaries are UI copy. Parameters come from the generated
// projection of src/whisper_subtitle/domain/presets.py.
const PRESET_PRESENTATION: PresetPresentation[] = [
  {
    id: 'cn',
    label: '中文转录',
    language: '中文',
    summary: '自动识别主语言 · 中文断句与标点',
  },
  {
    id: 'cn2',
    label: '中文防幻觉',
    language: '中文',
    summary: '自动识别主语言 · 中文排版与循环清理',
  },
  {
    id: 'en_v1',
    label: '英文转录',
    language: 'English',
    summary: 'Auto-detect primary language · English formatting',
  },
  {
    id: 'en_v2',
    label: '英文防幻觉',
    language: 'English',
    summary: 'Auto-detect primary language · English anti-loop cleanup',
  },
];

const DEFAULT_MODEL_ID: ModelId = 'large-v3-turbo';

export const PRESETS: PresetDefinition[] = PRESET_PRESENTATION.map((preset) => ({
  ...preset,
  parameters: { ...GENERATED_PRESET_PARAMETERS[preset.id][DEFAULT_MODEL_ID] },
}));

export function getPreset(
  id: PresetDefinition['id'],
  modelId: ModelId = DEFAULT_MODEL_ID,
): PresetDefinition {
  const preset = PRESET_PRESENTATION.find((item) => item.id === id);
  if (preset === undefined) throw new Error(`Unknown preset: ${id}`);
  return { ...preset, parameters: { ...GENERATED_PRESET_PARAMETERS[id][modelId] } };
}

export function modelProfileSummary(modelId: ModelId): string {
  const maximum = GENERATED_MODEL_PROFILES[modelId].temperatureFallbackMax;
  if (maximum !== null) {
    return modelId === 'large-v3'
      ? `Large-V3 质量优先 · 完整温度回退 0–${maximum.toFixed(1)}`
      : `Large-V3-Turbo 稳定优先 · 温度回退上限 ${maximum.toFixed(1)}`;
  }
  return '旧版模型兼容参数';
}

export function transcriptionTaskLabel(task: TranscriptionTask | undefined): string {
  return task === 'translate' ? '翻译为英语' : '原声转录';
}

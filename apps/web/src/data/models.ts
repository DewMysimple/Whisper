import { VISIBLE_MODEL_IDS, type ModelId } from '../contracts/desktop';

export { VISIBLE_MODEL_IDS };

export interface ModelPresentation {
  label: string;
  tier: string;
  speed: string;
  accuracy: string;
  summary: string;
}

export const MODEL_PRESENTATIONS: Record<ModelId, ModelPresentation> = {
  tiny: {
    label: 'Tiny',
    tier: '轻量',
    speed: '最快',
    accuracy: '基础',
    summary: '适合快速草稿、短音频和资源受限设备。',
  },
  base: {
    label: 'Base',
    tier: '轻量+',
    speed: '很快',
    accuracy: '基础+',
    summary: '在速度与基础识别质量之间增加少量余量。',
  },
  small: {
    label: 'Small',
    tier: '均衡',
    speed: '较快',
    accuracy: '均衡',
    summary: '适合日常批量处理和中等复杂度录音。',
  },
  medium: {
    label: 'Medium',
    tier: '质量',
    speed: '中等',
    accuracy: '较高',
    summary: '为口音、噪声和长内容提供更充足的识别能力。',
  },
  'large-v3': {
    label: 'Large V3',
    tier: '高精度',
    speed: '较慢',
    accuracy: '最高档',
    summary: '面向优先追求识别质量的本地转录任务，并支持本地语音翻译为英语。',
  },
  'large-v3-turbo': {
    label: 'Large V3 Turbo',
    tier: '默认推荐',
    speed: '高性能',
    accuracy: '高',
    summary: '当前正式默认，在质量、速度和显存占用之间保持平衡；仅用于原声转录。',
  },
};

export function getModelLabel(modelId: ModelId): string {
  return MODEL_PRESENTATIONS[modelId].label;
}

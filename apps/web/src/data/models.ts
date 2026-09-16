import type { ModelId } from '../contracts/desktop';

const MODEL_LABELS: Record<ModelId, string> = {
  tiny: 'Tiny',
  base: 'Base',
  small: 'Small',
  medium: 'Medium',
  'large-v3': 'Large V3',
  'large-v3-turbo': 'Large V3 Turbo',
};

export function getModelLabel(modelId: ModelId): string {
  return MODEL_LABELS[modelId];
}

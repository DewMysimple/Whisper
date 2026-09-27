import type { ModelId } from '../contracts/desktop';
import { MODEL_CAPABILITIES } from '../contracts/modelCatalog.generated';

export function getModelLabel(modelId: ModelId): string {
  return MODEL_CAPABILITIES[modelId].label;
}

export function isQwenModel(modelId: ModelId): boolean {
  return MODEL_CAPABILITIES[modelId].backend === 'qwen3-asr';
}

export function supportsParameter(modelId: ModelId, name: string): boolean {
  const parameters: readonly string[] | null = MODEL_CAPABILITIES[modelId].parameters;
  return parameters === null || parameters.includes(name);
}

export function supportsLanguage(modelId: ModelId, value: unknown): boolean {
  const languages: readonly string[] | null = MODEL_CAPABILITIES[modelId].languages;
  return value === null || languages === null || languages.includes(String(value));
}

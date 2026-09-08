import type {
  EditableParameters,
  ModelId,
  PresetId,
  RecognitionStrategy,
  V3ModelId,
} from '../contracts/desktop';
import { getPreset } from '../data/presets';

export const V3_MODEL_IDS: readonly V3ModelId[] = ['large-v3', 'large-v3-turbo'];
export const DEFAULT_RECOGNITION_STRATEGY: RecognitionStrategy = 'stable_primary';

export type ParameterProfileKey = `${V3ModelId}:${PresetId}`;
export type ParameterProfiles = Partial<Record<ParameterProfileKey, Partial<EditableParameters>>>;
export type RecognitionStrategyProfiles = Partial<Record<ParameterProfileKey, RecognitionStrategy>>;

export function isV3ModelId(modelId: ModelId): modelId is V3ModelId {
  return V3_MODEL_IDS.includes(modelId as V3ModelId);
}

export function translationTaskSupported(modelId: ModelId, presetId: PresetId): boolean {
  return modelId !== 'large-v3-turbo' && (presetId === 'en_v1' || presetId === 'en_v2');
}

export function parameterProfileKey(modelId: V3ModelId, presetId: PresetId): ParameterProfileKey {
  return `${modelId}:${presetId}`;
}

export function profileOverrides(
  profiles: ParameterProfiles,
  modelId: ModelId,
  presetId: PresetId,
): Partial<EditableParameters> {
  if (!isV3ModelId(modelId)) return {};
  return sanitizeProfileOverrides(
    modelId,
    presetId,
    profiles[parameterProfileKey(modelId, presetId)] ?? {},
  );
}

export function profileParameters(
  profiles: ParameterProfiles,
  modelId: ModelId,
  presetId: PresetId,
): EditableParameters {
  return {
    ...getPreset(presetId, modelId).parameters,
    ...profileOverrides(profiles, modelId, presetId),
  };
}

export function withProfileOverrides(
  profiles: ParameterProfiles,
  modelId: ModelId,
  presetId: PresetId,
  overrides: Partial<EditableParameters>,
): ParameterProfiles {
  if (!isV3ModelId(modelId)) return profiles;
  const key = parameterProfileKey(modelId, presetId);
  const sanitized = sanitizeProfileOverrides(modelId, presetId, overrides);
  const next = { ...profiles };
  if (Object.keys(sanitized).length === 0) delete next[key];
  else next[key] = sanitized;
  return next;
}

export function sanitizeProfileOverrides(
  modelId: ModelId,
  presetId: PresetId,
  overrides: Partial<EditableParameters>,
): Partial<EditableParameters> {
  const sanitized = { ...overrides };
  if (sanitized.task === 'translate' && !translationTaskSupported(modelId, presetId)) {
    delete sanitized.task;
  }
  return sanitized;
}

export function normalizePromptText(value: string): string {
  return Array.from(value.replaceAll('\r\n', '\n').replaceAll('\r', '\n'))
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return character === '\n' || character === '\t' || code >= 0x20;
    })
    .slice(0, 4000)
    .join('');
}

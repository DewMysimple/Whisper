import { describe, expect, it } from 'vitest';

import { getPreset, modelProfileSummary } from './presets';

describe('model-aware transcription presets', () => {
  it('uses calibrated anti-hallucination thresholds for V3-family models', () => {
    for (const modelId of ['large-v3', 'large-v3-turbo'] as const) {
      const preset = getPreset('cn2', modelId);
      expect(preset.parameters.log_prob_threshold).toBe(-1);
      expect(preset.parameters.no_speech_threshold).toBe(0.6);
    }
  });

  it('keeps legacy parameters for the small models', () => {
    const preset = getPreset('cn2', 'medium');
    expect(preset.parameters.log_prob_threshold).toBe(-1.5);
    expect(preset.parameters.no_speech_threshold).toBe(0.8);
  });

  it('describes the distinct V3 and Turbo fallback ladders', () => {
    expect(modelProfileSummary('large-v3')).toContain('1.0');
    expect(modelProfileSummary('large-v3-turbo')).toContain('0.6');
  });
});

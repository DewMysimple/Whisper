import { describe, expect, it } from 'vitest';

import type { TranscriptionDraft } from '../contracts/desktop';
import { getPreset } from '../data/presets';
import { getSubtitlePreset } from '../data/subtitlePresets';
import { normalizeDraft } from './workspaceDraft';

describe('normalizeDraft', () => {
  it('drops retired hardware preferences from legacy task snapshots', () => {
    const legacy = {
      inputs: [],
      modelId: 'large-v3-turbo',
      basePresetId: 'en_v1',
      overrides: {},
      effectiveParameters: { ...getPreset('en_v1').parameters },
      profileMode: 'transcript',
      subtitleParameters: { ...getSubtitlePreset('en_v1').subtitleParameters },
      output: {
        mode: 'compatibility',
        rootDirectory: null,
        txtEnabled: true,
        markdownEnabled: false,
        srtEnabled: false,
        preserveSourceTxt: false,
        preserveSourceMarkdown: false,
        conflictPolicy: 'confirm_overwrite',
      },
      hardware: {
        mode: 'cpu',
        gpuDeviceIndex: 0,
        cudaComputeType: 'float16',
        cpuComputeType: 'float32',
        cpuThreads: 8,
      },
    } as TranscriptionDraft & { hardware: unknown };

    expect(normalizeDraft(legacy)).not.toHaveProperty('hardware');
  });
});

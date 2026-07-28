import { describe, expect, it } from 'vitest';

import {
  normalizePromptText,
  profileOverrides,
  profileParameters,
  withProfileOverrides,
} from './parameterProfiles';

describe('model and preset parameter profiles', () => {
  it('isolates overrides across both model and preset dimensions', () => {
    let profiles = {};
    profiles = withProfileOverrides(profiles, 'large-v3-turbo', 'en_v1', {
      beam_size: 7,
      temperature: 0,
    });
    profiles = withProfileOverrides(profiles, 'large-v3', 'en_v1', {
      beam_size: 9,
    });

    expect(profileOverrides(profiles, 'large-v3-turbo', 'en_v1')).toEqual({
      beam_size: 7,
      temperature: 0,
    });
    expect(profileParameters(profiles, 'large-v3', 'en_v1').beam_size).toBe(9);
    expect(profileParameters(profiles, 'large-v3-turbo', 'en_v2').beam_size).toBe(5);
  });

  it('keeps line breaks, removes invalid controls and enforces 4000 Unicode characters', () => {
    const normalized = normalizePromptText(`A\r\nB\u0000${'😀'.repeat(4000)}`);

    expect(normalized.startsWith('A\nB')).toBe(true);
    expect(normalized).not.toContain('\u0000');
    expect(Array.from(normalized)).toHaveLength(4000);
  });

  it('keeps translation only for the Large V3 English profiles', () => {
    const full = withProfileOverrides({}, 'large-v3', 'en_v2', { task: 'translate' });
    const turbo = withProfileOverrides({}, 'large-v3-turbo', 'en_v2', {
      task: 'translate',
    });
    const chinese = withProfileOverrides({}, 'large-v3', 'cn2', { task: 'translate' });

    expect(profileOverrides(full, 'large-v3', 'en_v2').task).toBe('translate');
    expect(profileOverrides(turbo, 'large-v3-turbo', 'en_v2').task).toBeUndefined();
    expect(profileOverrides(chinese, 'large-v3', 'cn2').task).toBeUndefined();
  });
});

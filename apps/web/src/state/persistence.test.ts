import { beforeEach, describe, expect, it } from 'vitest';

import type { TaskSnapshot } from '../contracts/desktop';
import { getPreset } from '../data/presets';
import {
  exportPreferences,
  importPreferences,
  loadWorkspaceState,
  saveWorkspaceState,
  type WorkspacePreferences,
} from './persistence';

const preferences: WorkspacePreferences = {
  theme: 'dark',
  selectedPresetId: 'en_v1',
  parameters: { ...getPreset('en_v1').parameters },
  overrides: {},
  output: {
    mode: 'compatibility',
    rootDirectory: null,
    txtEnabled: true,
    markdownEnabled: false,
    preserveSourceTxt: true,
    conflictPolicy: 'fail',
  },
};

const runningTask: TaskSnapshot = {
  id: 'task-persisted',
  title: 'persisted.wav',
  sourceCount: 1,
  presetId: 'en_v1',
  isCustom: false,
  status: 'running',
  progress: 50,
  stage: 'GPU 转录中',
  elapsed: '00:10',
  createdAt: '10:00',
};

describe('desktop workspace persistence', () => {
  beforeEach(() => localStorage.clear());

  it('restores preferences and marks active work as interrupted', () => {
    saveWorkspaceState(preferences, [runningTask]);
    const restored = loadWorkspaceState();
    expect(restored?.preferences.theme).toBe('dark');
    expect(restored?.tasks[0]).toEqual(
      expect.objectContaining({ status: 'failed', errorCode: 'host.session_interrupted' }),
    );
  });

  it('round-trips versioned configuration and rejects invalid ranges', () => {
    expect(importPreferences(exportPreferences(preferences))).toEqual(preferences);
    expect(() =>
      importPreferences(
        JSON.stringify({
          schemaVersion: 1,
          preferences: { ...preferences, parameters: { ...preferences.parameters, beam_size: 99 } },
        }),
      ),
    ).toThrow(/字段或参数范围/);
  });
});

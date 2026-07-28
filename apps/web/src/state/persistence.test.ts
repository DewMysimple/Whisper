import { beforeEach, describe, expect, it } from 'vitest';

import type { TaskSnapshot } from '../contracts/desktop';
import { getPreset } from '../data/presets';
import { getSubtitlePreset } from '../data/subtitlePresets';
import {
  exportPreferences,
  importPreferences,
  loadWorkspaceState,
  saveWorkspaceState,
  type WorkspacePreferences,
} from './persistence';

const preferences: WorkspacePreferences = {
  theme: 'dark',
  accentPreset: 'blue',
  customAccentColor: '#1A73E8',
  uiFontSize: 15,
  logFontSize: 13,
  uiFontFamily: 'microsoft-yahei-ui',
  monoFontFamily: 'consolas',
  selectedModelId: 'large-v3-turbo',
  hardwarePreference: {
    mode: 'auto',
    gpuDeviceIndex: 0,
    cudaComputeType: 'float16',
    cpuComputeType: 'int8',
    cpuThreads: 4,
  },
  selectedPresetId: 'en_v1',
  profileMode: 'transcript',
  recognitionStrategy: 'stable_primary',
  recognitionStrategyProfiles: {},
  parameters: { ...getPreset('en_v1').parameters },
  overrides: {},
  parameterProfiles: {},
  subtitleParameters: { ...getSubtitlePreset('en_v1').subtitleParameters },
  subtitleOverrides: {},
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
};

const runningTask: TaskSnapshot = {
  id: 'task-persisted',
  title: 'persisted.wav',
  sourceCount: 1,
  presetId: 'en_v1',
  modelId: 'large-v3-turbo',
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
    expect(restored?.preferences).toEqual(expect.objectContaining(preferences));
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

  it('migrates a hidden legacy default model to Turbo without rewriting task history', () => {
    const legacy = {
      schemaVersion: 1,
      preferences: {
        ...preferences,
        selectedModelId: 'medium',
        parameterProfiles: undefined,
        overrides: { beam_size: 8 },
        parameters: { ...preferences.parameters, beam_size: 8 },
      },
      tasks: [{ ...runningTask, status: 'completed', modelId: 'medium' }],
    };
    localStorage.setItem('whisper-subtitle.desktop-state.v1', JSON.stringify(legacy));

    const restored = loadWorkspaceState();
    expect(restored?.preferences.selectedModelId).toBe('large-v3-turbo');
    expect(restored?.preferences.parameters.beam_size).toBe(8);
    expect(restored?.preferences.parameterProfiles['large-v3-turbo:en_v1']?.beam_size).toBe(8);
    expect(restored?.tasks[0]?.modelId).toBe('medium');
  });

  it('migrates an unsupported Turbo translation profile back to transcription', () => {
    const legacy = {
      schemaVersion: 1,
      preferences: {
        ...preferences,
        selectedModelId: 'large-v3-turbo',
        parameters: { ...preferences.parameters, task: 'translate' },
        overrides: { task: 'translate' },
        parameterProfiles: {
          'large-v3-turbo:en_v1': { task: 'translate' },
        },
      },
      tasks: [],
    };
    localStorage.setItem('whisper-subtitle.desktop-state.v1', JSON.stringify(legacy));

    const restored = loadWorkspaceState();
    expect(restored?.preferences.parameters.task).toBe('transcribe');
    expect(restored?.preferences.parameterProfiles['large-v3-turbo:en_v1']?.task).toBeUndefined();
  });

  it('persists model-preset recognition strategy and normalizes unsupported presets', () => {
    const mixed = {
      ...preferences,
      selectedPresetId: 'cn2' as const,
      recognitionStrategy: 'mixed_zh_en' as const,
      recognitionStrategyProfiles: {
        'large-v3-turbo:cn2': 'mixed_zh_en' as const,
      },
    };
    expect(importPreferences(exportPreferences(mixed))).toEqual(
      expect.objectContaining({
        selectedPresetId: 'cn2',
        recognitionStrategy: 'mixed_zh_en',
        recognitionStrategyProfiles: {
          'large-v3-turbo:cn2': 'mixed_zh_en',
        },
      }),
    );

    const invalid = JSON.parse(exportPreferences(mixed));
    invalid.preferences.selectedPresetId = 'en_v2';
    invalid.preferences.recognitionStrategy = 'mixed_zh_en';
    invalid.preferences.recognitionStrategyProfiles = {
      'large-v3-turbo:en_v2': 'mixed_zh_en',
    };
    const restored = importPreferences(JSON.stringify(invalid));
    expect(restored.recognitionStrategy).toBe('stable_primary');
    expect(restored.recognitionStrategyProfiles).toEqual({});

    const detail = {
      ...mixed,
      recognitionStrategy: 'zh_detail_review' as const,
      recognitionStrategyProfiles: {
        'large-v3-turbo:cn2': 'zh_detail_review' as const,
      },
    };
    expect(importPreferences(exportPreferences(detail))).toEqual(
      expect.objectContaining({
        recognitionStrategy: 'zh_detail_review',
        recognitionStrategyProfiles: {
          'large-v3-turbo:cn2': 'zh_detail_review',
        },
      }),
    );
  });

  it('migrates old version-one appearance fields and keeps the orange default restorable', () => {
    const legacy = JSON.parse(exportPreferences(preferences));
    delete legacy.preferences.accentPreset;
    delete legacy.preferences.customAccentColor;
    delete legacy.preferences.uiFontSize;
    delete legacy.preferences.logFontSize;
    delete legacy.preferences.uiFontFamily;
    delete legacy.preferences.monoFontFamily;
    delete legacy.preferences.selectedModelId;
    delete legacy.preferences.hardwarePreference;
    legacy.preferences.contentFontSize = 'small';
    delete legacy.preferences.output.preserveSourceMarkdown;
    legacy.preferences.output.conflictPolicy = 'fail';
    const migrated = importPreferences(JSON.stringify(legacy));
    expect(migrated).toEqual(
      expect.objectContaining({
        accentPreset: 'orange',
        customAccentColor: '#FF5B04',
        uiFontSize: 12,
        logFontSize: 12,
        uiFontFamily: 'system',
        monoFontFamily: 'cascadia-mono',
        selectedModelId: 'large-v3-turbo',
        hardwarePreference: {
          mode: 'auto',
          gpuDeviceIndex: 0,
          cudaComputeType: 'float16',
          cpuComputeType: 'int8',
          cpuThreads: 4,
        },
      }),
    );
    expect(migrated.output.preserveSourceMarkdown).toBe(false);
    expect(migrated.output.conflictPolicy).toBe('confirm_overwrite');

    legacy.preferences.contentFontSize = 'balanced';
    expect(importPreferences(JSON.stringify(legacy)).uiFontSize).toBe(14);
    legacy.preferences.contentFontSize = 'large';
    expect(importPreferences(JSON.stringify(legacy)).uiFontSize).toBe(16);
  });

  it('rejects invalid appearance ranges, colors and font identifiers', () => {
    const invalid = JSON.parse(exportPreferences(preferences));
    invalid.preferences.uiFontSize = 19;
    expect(() => importPreferences(JSON.stringify(invalid))).toThrow(/字段或参数范围/);
    invalid.preferences.uiFontSize = 14;
    invalid.preferences.logFontSize = 9;
    expect(() => importPreferences(JSON.stringify(invalid))).toThrow(/字段或参数范围/);
    invalid.preferences.logFontSize = 12;
    invalid.preferences.customAccentColor = '#12345';
    expect(() => importPreferences(JSON.stringify(invalid))).toThrow(/字段或参数范围/);
    invalid.preferences.customAccentColor = '#123456';
    invalid.preferences.uiFontFamily = 'unknown';
    expect(() => importPreferences(JSON.stringify(invalid))).toThrow(/字段或参数范围/);
  });

  it('migrates the former two-line SRT default but keeps an explicit override', () => {
    const legacy = JSON.parse(exportPreferences(preferences));
    legacy.preferences.subtitleParameters.max_lines_per_cue = 2;
    legacy.preferences.subtitleOverrides = {};
    expect(importPreferences(JSON.stringify(legacy)).subtitleParameters.max_lines_per_cue).toBe(1);

    legacy.preferences.subtitleOverrides = { max_lines_per_cue: 2 };
    expect(importPreferences(JSON.stringify(legacy)).subtitleParameters.max_lines_per_cue).toBe(2);
  });
});

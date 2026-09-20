import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopBridge } from '../bridge';
import { PARAMETER_GROUPS } from '../data/parameterPresentation';
import { PARAMETER_RULES, isParameterValue } from './parameterValidation';
import { useWorkspace } from './workspace';
import { exportPreferences, importPreferences } from './persistence';
import { preferencesFromState } from './workspacePersistence';

describe('model and parameter workbench', () => {
  beforeEach(() => {
    useWorkspace.setState({
      parameterProfiles: {},
      tasks: [],
      startingTask: false,
      pendingOverwrite: null,
      pendingShutdownStart: null,
      finishAction: 'none',
      hostStatus: { state: 'ready', pid: 1, launchKind: 'mock', error: null },
    });
    useWorkspace.getState().selectModel('large-v3-turbo');
    useWorkspace.getState().selectProfile('transcript', 'cn2');
  });
  afterEach(() => vi.restoreAllMocks());

  it('provides exactly one field for every supported public parameter', () => {
    const keys = PARAMETER_GROUPS.flatMap((group) => group.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(Object.keys(PARAMETER_RULES).sort());
    expect(isParameterValue('temperature', [0.8, 0.2])).toBe(false);
    expect(isParameterValue('beam_size', 3.5)).toBe(false);
  });

  it('isolates all supported model/preset profiles and persists null, sequence and text overrides', () => {
    const store = useWorkspace.getState;
    store().setParameter('temperature', 0);
    store().setParameter('language', 'zh');
    store().setParameter('initial_prompt', 'Whisper\n中文');
    store().setParameter('no_speech_threshold', null);
    store().selectModel('medium');
    expect(store().overrides).toEqual({});
    store().setParameter('beam_size', 8);
    store().selectProfile('transcript', 'en_v2');
    expect(store().overrides).toEqual({});
    store().setParameter('task', 'translate');
    store().selectModel('large-v3-turbo');
    expect(store().parameters.task).toBe('transcribe');
    store().selectProfile('transcript', 'cn2');
    expect(store().overrides).toEqual({
      temperature: 0,
      language: 'zh',
      initial_prompt: 'Whisper\n中文',
      no_speech_threshold: null,
    });
    const restored = importPreferences(exportPreferences(preferencesFromState(store())));
    expect(restored.parameterProfiles['medium:cn2']).toEqual({ beam_size: 8 });
    expect(restored.overrides).toEqual(store().overrides);
    store().resetParameter('temperature');
    expect(store().parameters.temperature).toEqual([0, 0.2, 0.4, 0.6]);
    expect(store().overrides).not.toHaveProperty('temperature');
  });

  it('freezes custom options into submission while later UI edits affect only future tasks', async () => {
    const start = vi
      .spyOn(desktopBridge, 'startTranscription')
      .mockResolvedValue({ taskId: 'config-snapshot' });
    useWorkspace.setState({
      inputs: [{ id: 'a', path: 'fixture.wav', valid: true, kind: 'file', origin: 'dialog' }],
    });
    const store = useWorkspace.getState;
    store().setParameter('temperature', [0, 0.3, 0.6]);
    store().setParameter('vad_threshold', 0.65);
    store().setParameter('suppress_tokens', []);
    await store().startTask();
    expect(start).toHaveBeenCalledOnce();
    const submitted = start.mock.calls[0]![0];
    expect(submitted.overrides).toEqual({
      temperature: [0, 0.3, 0.6],
      vad_threshold: 0.65,
      suppress_tokens: [],
    });
    store().selectModel('medium');
    store().setParameter('vad_threshold', 0.8);
    expect(submitted.modelId).toBe('large-v3-turbo');
    expect(submitted.effectiveParameters.vad_threshold).toBe(0.65);
  });

  it('normalizes prompts and records mandatory SRT alignment without changing the saved text profile', async () => {
    const start = vi
      .spyOn(desktopBridge, 'startTranscription')
      .mockResolvedValue({ taskId: 'srt-config' });
    useWorkspace.setState({
      inputs: [{ id: 'a', path: 'fixture.wav', valid: true, kind: 'file', origin: 'dialog' }],
    });
    const store = useWorkspace.getState;
    store().setParameter('initial_prompt', '  中文\r\nWhisper  ');
    expect(store().parameters.initial_prompt).toBe('中文\nWhisper');
    store().selectProfile('subtitle', 'cn2');
    expect(store().parameters.word_timestamps).toBe(false);
    await store().startTask();
    expect(start.mock.calls[0]![0].effectiveParameters.word_timestamps).toBe(true);
    expect(store().parameters.word_timestamps).toBe(false);
  });
});

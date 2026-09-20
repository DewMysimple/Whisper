import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopBridge } from '../bridge';
import { executionProblem, isExecutionOptions, readHardwareCapabilities } from './executionOptions';
import { useWorkspace } from './workspace';
import { exportPreferences, importPreferences } from './persistence';
import { preferencesFromState } from './workspacePersistence';

describe('hardware execution options', () => {
  beforeEach(() =>
    useWorkspace.setState({
      executionOptions: {},
      inputs: [],
      tasks: [],
      startingTask: false,
      pendingOverwrite: null,
      pendingShutdownStart: null,
      finishAction: 'none',
      hostStatus: { state: 'ready', pid: 1, launchKind: 'mock', error: null },
    }),
  );
  afterEach(() => vi.restoreAllMocks());

  it('validates IPC boundaries, inheritance and unavailable hardware', async () => {
    expect(isExecutionOptions({})).toBe(true);
    expect(isExecutionOptions({ device: 'cpu', cpu_threads: 0 })).toBe(true);
    for (const invalid of [
      { cpu_threads: -1 },
      { cpu_threads: 257 },
      { cpu_threads: 2.5 },
      { device_index: 32 },
      { device: 'gpu' },
      { compute_type: 'fp16' },
      { constructor: 1 },
      { cpu_threads: null },
    ])
      expect(isExecutionOptions(invalid)).toBe(false);
    const capabilities = await desktopBridge.getHardwareCapabilities();
    expect(executionProblem({ device: 'cpu', compute_type: 'float16' }, capabilities)).toContain(
      '不支持',
    );
    expect(executionProblem({ device: 'cuda', device_index: 9 }, capabilities)).toContain('不可用');
    expect(executionProblem({ device: 'cpu', cpu_threads: 0 }, capabilities)).toBeNull();
  });

  it('rejects missing or malformed capabilities instead of inventing hardware', () => {
    expect(() => readHardwareCapabilities({})).toThrow('未提供硬件能力');
    expect(() => readHardwareCapabilities({ hardware_error: 'CUDA probe failed' })).toThrow(
      'CUDA probe failed',
    );
    expect(() =>
      readHardwareCapabilities({
        hardware_capabilities: {
          cpu_threads: 4,
          devices: [{ device: 'cpu', device_index: '0', compute_types: ['int8'], name: 'CPU' }],
        },
      }),
    ).toThrow('无效');
    expect(
      readHardwareCapabilities({
        hardware_capabilities: {
          cpu_threads: 4,
          devices: [{ device: 'cpu', device_index: 0, name: 'CPU', compute_types: ['int8'] }],
        },
      }),
    ).toEqual({
      cpuThreads: 4,
      devices: [{ device: 'cpu', deviceIndex: 0, name: 'CPU', computeTypes: ['int8'] }],
    });
  });

  it('persists explicit zero, drops retired preferences, and restores defaults', () => {
    const store = useWorkspace.getState;
    store().setExecutionOptions({ device: 'cpu', compute_type: 'int8', cpu_threads: 0 });
    const exported = JSON.parse(exportPreferences(preferencesFromState(store())));
    expect(importPreferences(JSON.stringify(exported)).executionOptions).toEqual(
      store().executionOptions,
    );
    delete exported.preferences.executionOptions;
    exported.preferences.hardwarePreference = { device: 'cuda', computeType: 'float16' };
    expect(importPreferences(JSON.stringify(exported)).executionOptions).toEqual({});
    store().setExecutionOptions({});
    expect(store().executionOptions).toEqual({});
  });

  it('freezes settings before asynchronous submission and restores them with history', async () => {
    const start = vi
      .spyOn(desktopBridge, 'startTranscription')
      .mockResolvedValue({ taskId: 'hardware-task' });
    const store = useWorkspace.getState;
    store().selectModel('large-v3-turbo');
    store().selectProfile('transcript', 'cn2');
    useWorkspace.setState({
      output: { ...store().output, txtEnabled: true, mode: 'compatibility' },
      inputs: [
        {
          id: 'gpu-input',
          path: 'C:\\Media\\sample.wav',
          kind: 'file',
          origin: 'dialog',
          valid: true,
        },
      ],
    });
    store().setExecutionOptions({ device: 'cpu', compute_type: 'int8', cpu_threads: 2 });
    const submitting = store().startTask();
    store().setExecutionOptions({ device: 'cuda', compute_type: 'float16' });
    await submitting;
    const submitted = start.mock.calls[0]![0];
    expect(submitted.execution).toEqual({ device: 'cpu', compute_type: 'int8', cpu_threads: 2 });
    useWorkspace.setState({
      tasks: [
        {
          id: 'hardware-history',
          title: 'sample.wav',
          presetId: 'cn2',
          modelId: 'large-v3-turbo',
          sourceCount: 1,
          isCustom: false,
          status: 'completed',
          progress: 100,
          stage: '完成',
          elapsed: '00:01',
          createdAt: new Date().toISOString(),
          draft: submitted,
        },
      ],
    });
    await store().retryTask('hardware-history');
    expect(store().executionOptions).toEqual(submitted.execution);
  });
});

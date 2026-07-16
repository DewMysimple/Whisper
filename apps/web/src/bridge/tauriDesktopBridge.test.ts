import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopEvent, TranscriptionDraft } from '../contracts/desktop';

const native = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  dragHandler: undefined as
    ((event: { payload: { type: string; paths: string[] } }) => void) | undefined,
  invoke: vi.fn(),
  open: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    native.handlers.set(name, handler);
    return () => native.handlers.delete(name);
  }),
}));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: async (
      handler: (event: { payload: { type: string; paths: string[] } }) => void,
    ) => {
      native.dragHandler = handler;
      return () => {
        native.dragHandler = undefined;
      };
    },
  }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: native.open }));

import { TauriDesktopBridge } from './tauriDesktopBridge';

const DRAFT: TranscriptionDraft = {
  inputs: [
    {
      id: 'source-1',
      path: 'F:\\Media\\lesson.wav',
      kind: 'file',
      origin: 'dialog',
      valid: true,
    },
  ],
  basePresetId: 'en_v1',
  overrides: {},
  effectiveParameters: {
    beam_size: 5,
    best_of: 5,
    patience: 1.5,
    temperature: 0,
    no_speech_threshold: 0.6,
    condition_on_previous_text: true,
  },
  output: {
    mode: 'compatibility',
    rootDirectory: null,
    txtEnabled: true,
    markdownEnabled: false,
    preserveSourceTxt: true,
    conflictPolicy: 'fail',
  },
};

describe('TauriDesktopBridge', () => {
  beforeEach(() => {
    native.handlers.clear();
    native.dragHandler = undefined;
    native.invoke.mockReset();
    native.open.mockReset();
    native.invoke.mockImplementation(
      async (command: string, arguments_: Record<string, unknown>) => {
        if (command === 'get_host_status') {
          return { state: 'ready', pid: 123, launchKind: 'development-python', error: null };
        }
        if (command === 'worker_environment') {
          return {
            schema_version: 1,
            type: 'event',
            event: 'command.completed',
            data: {
              method: 'system.environment',
              result: { available: true, errors: [], python: '3.14.2', platform: 'Windows' },
            },
          };
        }
        if (command === 'worker_metrics') {
          return {
            schema_version: 1,
            type: 'event',
            event: 'command.completed',
            data: {
              method: 'system.metrics',
              result: {
                timestamp_ms: 1234,
                cpu_percent: 25,
                memory_percent: 40,
                memory_used_gib: 12,
                memory_total_gib: 32,
                gpu_percent: 70,
                vram_used_gib: 8,
                vram_total_gib: 16,
                gpu_name: 'Test GPU',
              },
            },
          };
        }
        if (command === 'inspect_inputs') {
          const paths = arguments_.paths as string[];
          return paths.map((path) => ({
            path,
            kind: 'file',
            origin: arguments_.origin,
            valid: true,
            detail: null,
          }));
        }
        if (command === 'start_transcription') {
          const draft = arguments_.draft as { requestId: string };
          native.handlers.get('desktop://worker-message')?.({
            payload: {
              schema_version: 1,
              type: 'event',
              request_id: draft.requestId,
              task_id: 'task-real-1',
              event: 'task.queued',
              data: { position: 0, input_count: 1, effective_parameters: {} },
            },
          });
          return { requestId: draft.requestId, taskId: 'task-real-1' };
        }
        return {};
      },
    );
  });

  it('maps validated Worker task messages without parsing presentation text', async () => {
    const bridge = new TauriDesktopBridge();
    const events: DesktopEvent[] = [];
    const unsubscribe = bridge.subscribe((event) => events.push(event));
    await bridge.getHostStatus();
    await vi.waitFor(() => {
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'performance.sample',
          sample: expect.objectContaining({ gpu: 70, cpu: 25, gpuName: 'Test GPU' }),
        }),
      );
    });

    const started = await bridge.startTranscription(DRAFT);
    expect(started.taskId).toBe('task-real-1');
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'task.queued',
        task: expect.objectContaining({ id: 'task-real-1', title: 'lesson.wav' }),
      }),
    );

    native.handlers.get('desktop://worker-message')?.({
      payload: {
        schema_version: 1,
        type: 'event',
        task_id: 'task-real-1',
        event: 'task.completed',
        data: { success_count: 1, failure_count: 0, outputs: ['F:\\Text\\lesson.txt'] },
        message: '这段展示文字不会决定状态',
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'task.completed',
        taskId: 'task-real-1',
        outputs: ['F:\\Text\\lesson.txt'],
      }),
    );

    unsubscribe();
    bridge.dispose();
  });

  it('adds native drag paths through the Rust inspection command', async () => {
    const bridge = new TauriDesktopBridge();
    const events: DesktopEvent[] = [];
    bridge.subscribe((event) => events.push(event));
    await bridge.getHostStatus();
    native.dragHandler?.({ payload: { type: 'drop', paths: ['F:\\Media\\drop.wav'] } });
    await vi.waitFor(() => {
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'inputs.added',
          inputs: [expect.objectContaining({ path: 'F:\\Media\\drop.wav', origin: 'drop' })],
        }),
      );
    });
    bridge.dispose();
  });

  it('uses only the whitelisted Rust command to reveal an output', async () => {
    const bridge = new TauriDesktopBridge();
    await bridge.revealOutput('F:\\Text\\lesson.txt');
    expect(native.invoke).toHaveBeenCalledWith('reveal_output', {
      path: 'F:\\Text\\lesson.txt',
    });
  });
});

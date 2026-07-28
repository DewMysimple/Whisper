import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopEvent, TranscriptionDraft } from '../contracts/desktop';
import { getPreset } from '../data/presets';

const native = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  dragHandler: undefined as
    ((event: { payload: { type: string; paths: string[] } }) => void) | undefined,
  invoke: vi.fn(),
  open: vi.fn(),
  readText: vi.fn(),
  save: vi.fn(),
  writeText: vi.fn(),
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
vi.mock('@tauri-apps/api/path', () => ({
  desktopDir: vi.fn(async () => 'C:\\Users\\Test\\Desktop'),
  join: vi.fn(async (...parts: string[]) => parts.join('\\')),
}));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: native.readText,
  writeText: native.writeText,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: native.open, save: native.save }));

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
  modelId: 'large-v3-turbo',
  hardware: {
    mode: 'auto',
    gpuDeviceIndex: 0,
    cudaComputeType: 'float16',
    cpuComputeType: 'int8',
    cpuThreads: 4,
  },
  basePresetId: 'en_v1',
  profileMode: 'transcript',
  overrides: {},
  effectiveParameters: { ...getPreset('en_v1').parameters },
  subtitleParameters: {
    max_characters_per_line: 42,
    max_lines_per_cue: 2,
    min_cue_duration_ms: 800,
    max_cue_duration_ms: 7000,
    max_characters_per_second: 20,
    cue_gap_ms: 80,
  },
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

describe('TauriDesktopBridge', () => {
  beforeEach(() => {
    native.handlers.clear();
    native.dragHandler = undefined;
    native.invoke.mockReset();
    native.open.mockReset();
    native.readText.mockReset();
    native.save.mockReset();
    native.writeText.mockReset();
    native.readText.mockResolvedValue('"F:\\Media\\clipboard lesson.wav"');
    native.invoke.mockImplementation(
      async (command: string, arguments_: Record<string, unknown>) => {
        if (command === 'get_host_status') {
          return { state: 'ready', pid: 123, launchKind: 'development-python', error: null };
        }
        if (command === 'get_worker_logs') {
          return ['worker booted', 'worker ready'];
        }
        if (command === 'inspect_output_paths') {
          return (arguments_.paths as string[]).map((path) => ({
            path,
            exists: !path.includes('missing'),
          }));
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
                memory_available_gib: 20,
                swap_used_gib: 1,
                swap_total_gib: 32,
                worker_rss_gib: 0.4,
                worker_thread_count: 18,
                worker_handle_count: 264,
                cpu_name: 'Test CPU',
                cpu_frequency_mhz: 5200,
                cpu_physical_cores: 20,
                cpu_logical_cores: 28,
                system_process_count: 278,
                system_uptime_seconds: 16315,
                gpu_percent: 70,
                gpu_memory_controller_percent: 34,
                vram_used_gib: 8,
                vram_total_gib: 16,
                gpu_name: 'Test GPU',
                gpu_temperature_c: 44,
                gpu_clock_mhz: 2670,
                gpu_memory_clock_mhz: 14001,
                gpu_power_watts: 126,
                gpu_power_limit_watts: 300,
                gpu_fan_percent: 42,
                gpu_driver_version: '610.62',
                gpu_performance_state: 'P2',
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
            mediaCount: 1,
            detail: null,
          }));
        }
        if (command === 'start_transcription') {
          const draft = arguments_.draft as { requestId: string; modelId: string };
          native.handlers.get('desktop://worker-message')?.({
            payload: {
              schema_version: 1,
              type: 'event',
              request_id: draft.requestId,
              task_id: 'task-real-1',
              event: 'task.queued',
              data: {
                position: 0,
                input_count: 1,
                model_id: draft.modelId,
                effective_parameters: {},
              },
            },
          });
          return { requestId: draft.requestId, taskId: 'task-real-1' };
        }
        return {};
      },
    );
  });

  it('copies and exports the same Worker log text', async () => {
    const bridge = new TauriDesktopBridge();
    native.save.mockResolvedValue('C:\\Users\\Test\\Desktop\\worker.txt');
    native.invoke.mockImplementation(
      async (command: string, arguments_: Record<string, unknown>) => {
        if (command === 'write_worker_log_export') return arguments_.path;
        if (command === 'get_host_status') {
          return { state: 'ready', pid: 123, launchKind: 'development-python', error: null };
        }
        if (command === 'get_worker_logs') return [];
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
                timestamp_ms: 1,
                cpu_percent: 0,
                memory_percent: 0,
                memory_used_gib: 0,
                memory_total_gib: 1,
                gpu_percent: null,
                vram_used_gib: null,
                vram_total_gib: null,
                gpu_name: null,
              },
            },
          };
        }
        return {};
      },
    );

    const content = '[2026-07-22 02:00:00] [WORKER] ready\r\n';
    await bridge.copyWorkerLogs(content);
    await expect(bridge.exportWorkerLogs(content)).resolves.toBe(
      'C:\\Users\\Test\\Desktop\\worker.txt',
    );
    expect(native.writeText).toHaveBeenCalledWith(content);
    expect(native.invoke).toHaveBeenCalledWith('write_worker_log_export', {
      path: 'C:\\Users\\Test\\Desktop\\worker.txt',
      content,
    });
    bridge.dispose();
  });

  it('reads Windows clipboard text through the native clipboard capability', async () => {
    const bridge = new TauriDesktopBridge();
    await expect(bridge.readClipboardText()).resolves.toBe('"F:\\Media\\clipboard lesson.wav"');
    expect(native.readText).toHaveBeenCalledOnce();
    bridge.dispose();
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
          sample: expect.objectContaining({
            gpu: 70,
            cpu: 25,
            gpuName: 'Test GPU',
            gpuTemperature: 44,
            cpuName: 'Test CPU',
            workerRss: 0.4,
          }),
        }),
      );
    });

    const started = await bridge.startTranscription(DRAFT);
    expect(started.taskId).toBe('task-real-1');
    expect(native.invoke).toHaveBeenCalledWith(
      'start_transcription',
      expect.objectContaining({
        draft: expect.objectContaining({
          modelId: 'large-v3-turbo',
          output: expect.objectContaining({
            subtitle: {
              maxCharactersPerLine: 42,
              maxLinesPerCue: 2,
              minCueDurationMs: 800,
              maxCueDurationMs: 7000,
              maxCharactersPerSecond: 20,
              cueGapMs: 80,
            },
          }),
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'task.queued',
        task: expect.objectContaining({
          id: 'task-real-1',
          title: 'lesson.wav',
          modelId: 'large-v3-turbo',
          createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        }),
      }),
    );

    native.handlers.get('desktop://worker-message')?.({
      payload: {
        schema_version: 1,
        type: 'event',
        task_id: 'task-real-1',
        event: 'task.progress',
        data: {
          stage: 'output.writing',
          current: 1,
          total: 1,
          input_path: 'F:\\Media\\lesson.wav',
          media_index: 1,
          media_progress_percent: 100,
          media_elapsed_seconds: 9.5,
          task_elapsed_seconds: 10,
          media_status: 'completed',
          output_paths: ['F:\\Text\\lesson.txt'],
          quality_diagnostics: {
            detected_language: 'zh',
            language_probability: 0.92,
            segment_count: 2,
            fallback_segment_count: 1,
            max_temperature: 0.4,
            low_confidence_count: 1,
            recognition_strategy: 'mixed_zh_en',
            secondary_pass_count: 1,
            replaced_region_count: 1,
            review_region_count: 0,
            rejected_region_count: 0,
            detail_candidates: [
              {
                start: 35,
                end: 40,
                chinese_probability: 0.94,
                primary_text: '拟太环境',
                candidate_text: '拟态环境',
                decision: 'replaced',
                reason: 'hotword_recovered',
                primary_word_probability: 0.62,
                candidate_word_probability: 0.91,
                primary_log_probability: -0.85,
                candidate_log_probability: -0.62,
                recovered_hotwords: ['拟态'],
              },
            ],
            language_regions: [
              {
                start: 25,
                end: 31.5,
                top_language: 'en',
                top_probability: 0.91,
                english_probability: 0.91,
                chinese_probability: 0.04,
                primary_text: '第一遍文本',
                candidate_text: 'This is an English candidate.',
                decision: 'replaced',
                reason: null,
              },
            ],
            hotword_audit: {
              term_count: 2,
              matched_count: 1,
              missing_count: 1,
              matched_terms: ['Walter Lippmann'],
              missing_terms: ['simulacra-self'],
              omitted_term_count: 0,
            },
            segments: [
              {
                index: 1,
                start: 3,
                end: 5,
                text: '需要复核',
                temperature: 0.4,
                avg_logprob: -1.2,
                compression_ratio: 2.5,
                no_speech_prob: 0.1,
                reasons: ['fallback_temperature'],
              },
            ],
          },
        },
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'task.progress',
        taskId: 'task-real-1',
        mediaStatus: 'completed',
        outputPaths: ['F:\\Text\\lesson.txt'],
        qualityDiagnostics: expect.objectContaining({
          detectedLanguage: 'zh',
          lowConfidenceCount: 1,
          recognitionStrategy: 'mixed_zh_en',
          languageRegions: [
            expect.objectContaining({
              englishProbability: 0.91,
              decision: 'replaced',
            }),
          ],
          detailCandidates: [
            expect.objectContaining({
              primaryText: '拟太环境',
              candidateText: '拟态环境',
              decision: 'replaced',
              recoveredHotwords: ['拟态'],
            }),
          ],
          hotwordAudit: expect.objectContaining({
            matchedTerms: ['Walter Lippmann'],
          }),
        }),
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

  it('preserves structured output conflicts and only sends overwrite after confirmation', async () => {
    native.invoke.mockImplementation(
      async (command: string, arguments_: Record<string, unknown>) => {
        if (command === 'get_host_status') {
          return { state: 'ready', pid: 123, launchKind: 'development-python', error: null };
        }
        if (command === 'get_worker_logs') return [];
        if (command === 'start_transcription') {
          const draft = arguments_.draft as {
            output: { conflictPolicy: string };
          };
          if (draft.output.conflictPolicy === 'fail') {
            throw {
              code: 'output.failed',
              message: 'output target already exists',
              data: {
                exception: 'OutputConflictError',
                paths: ['D:\\Text\\lesson.txt', 'D:\\Markdown\\lesson.md'],
              },
            };
          }
          return { requestId: 'req-overwrite', taskId: 'task-overwrite' };
        }
        return {};
      },
    );
    const bridge = new TauriDesktopBridge();

    await expect(bridge.startTranscription(DRAFT)).rejects.toMatchObject({
      code: 'output.conflict',
      paths: ['D:\\Text\\lesson.txt', 'D:\\Markdown\\lesson.md'],
    });
    await expect(bridge.startTranscription(DRAFT, { allowOverwrite: true })).resolves.toEqual({
      taskId: 'task-overwrite',
    });

    const startCalls = native.invoke.mock.calls.filter(
      ([command]) => command === 'start_transcription',
    );
    expect(
      startCalls.map(
        ([, arguments_]) =>
          (arguments_ as { draft: { output: { conflictPolicy: string } } }).draft.output
            .conflictPolicy,
      ),
    ).toEqual(['fail', 'overwrite']);
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

  it('audits completed output paths through the local Rust host', async () => {
    const bridge = new TauriDesktopBridge();

    await expect(
      bridge.inspectOutputPaths(['F:\\Text\\available.txt', 'F:\\Text\\missing.txt']),
    ).resolves.toEqual([
      { path: 'F:\\Text\\available.txt', exists: true },
      { path: 'F:\\Text\\missing.txt', exists: false },
    ]);
    expect(native.invoke).toHaveBeenCalledWith('inspect_output_paths', {
      paths: ['F:\\Text\\available.txt', 'F:\\Text\\missing.txt'],
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

  it('opens an output directory through the whitelisted Rust command', async () => {
    const bridge = new TauriDesktopBridge();
    await bridge.openOutputDirectory('F:\\Text\\lesson.txt');
    expect(native.invoke).toHaveBeenCalledWith('open_output_directory', {
      path: 'F:\\Text\\lesson.txt',
    });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DesktopEvent, TranscriptionDraft } from '../contracts/desktop';
import { getPreset } from '../data/presets';
import { getSubtitlePreset } from '../data/subtitlePresets';
import { MockDesktopBridge } from './mockDesktopBridge';

describe('MockDesktopBridge', () => {
  afterEach(() => vi.useRealTimers());

  it('runs batches serially, reports every media output and preserves all selected formats', async () => {
    vi.useFakeTimers();
    const bridge = new MockDesktopBridge();
    const events: DesktopEvent[] = [];
    bridge.subscribe((event) => events.push(event));
    const draft: TranscriptionDraft = {
      inputs: await bridge.selectFiles(),
      modelId: 'large-v3-turbo',
      basePresetId: 'cn',
      profileMode: 'transcript',
      overrides: {},
      effectiveParameters: getPreset('cn').parameters,
      subtitleParameters: getSubtitlePreset('cn').subtitleParameters,
      output: {
        mode: 'compatibility',
        rootDirectory: null,
        txtEnabled: true,
        markdownEnabled: true,
        srtEnabled: true,
        preserveSourceTxt: false,
        preserveSourceMarkdown: false,
        conflictPolicy: 'confirm_overwrite',
      },
    };
    const first = await bridge.startTranscription(draft);
    const second = await bridge.startTranscription(draft);
    await vi.advanceTimersByTimeAsync(650);
    expect(
      events.filter((event) => event.type === 'task.progress').map((event) => event.taskId),
    ).toEqual([first.taskId]);
    await vi.advanceTimersByTimeAsync(4_550);
    const completed = events.find(
      (event) => event.type === 'task.completed' && event.taskId === first.taskId,
    );
    expect(completed).toMatchObject({
      outputs: expect.arrayContaining([
        expect.stringMatching(/\.txt$/),
        expect.stringMatching(/\.md$/),
        expect.stringMatching(/\.srt$/),
      ]),
      successCount: 2,
    });
    expect(
      events.filter((event) => event.type === 'task.progress' && event.mediaStatus === 'completed'),
    ).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(650);
    expect(events.filter((event) => event.type === 'task.progress').at(-1)).toMatchObject({
      taskId: second.taskId,
      taskElapsedSeconds: 0.65,
    });
    bridge.dispose();
  });

  it('does not deliver bootstrap logs to an unsubscribed development effect', async () => {
    const bridge = new MockDesktopBridge();
    const abandoned = vi.fn();
    bridge.subscribe(abandoned)();
    const current = vi.fn();
    const unlisten = bridge.subscribe(current);
    await Promise.resolve();
    expect(abandoned).not.toHaveBeenCalled();
    expect(current.mock.calls.filter(([event]) => event.type === 'worker.log')).toHaveLength(3);
    unlisten();
    bridge.subscribe(current);
    await Promise.resolve();
    expect(current.mock.calls.filter(([event]) => event.type === 'worker.log')).toHaveLength(3);
    bridge.dispose();
  });
  it('provides structured Windows paths and emits a typed queued event', async () => {
    const bridge = new MockDesktopBridge();
    const listener = vi.fn();
    const unlisten = bridge.subscribe(listener);
    const inputs = await bridge.selectFiles();
    const preset = getPreset('cn');
    const draft: TranscriptionDraft = {
      inputs,
      modelId: 'large-v3-turbo',
      basePresetId: 'cn',
      profileMode: 'transcript',
      overrides: {},
      effectiveParameters: preset.parameters,
      subtitleParameters: getSubtitlePreset('cn').subtitleParameters,
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

    const result = await bridge.startTranscription(draft);

    expect(bridge.mode).toBe('mock');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]?.path).toContain('课程目录');
    await expect(bridge.inspectOutputPaths(['D:\\Mock\\output.txt'])).resolves.toEqual([
      { path: 'D:\\Mock\\output.txt', exists: true },
    ]);
    expect(result.taskId).toMatch(/^mock-task-/);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.queued',
        task: expect.objectContaining({
          sourceCount: 2,
          createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        }),
      }),
    );

    unlisten();
    bridge.dispose();
  });
});

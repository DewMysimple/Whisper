import { describe, expect, it, vi } from 'vitest';

import type { TranscriptionDraft } from '../contracts/desktop';
import { getPreset } from '../data/presets';
import { getSubtitlePreset } from '../data/subtitlePresets';
import { MockDesktopBridge } from './mockDesktopBridge';

describe('MockDesktopBridge', () => {
  it('provides structured Windows paths and emits a typed queued event', async () => {
    const bridge = new MockDesktopBridge();
    const listener = vi.fn();
    const unlisten = bridge.subscribe(listener);
    const inputs = await bridge.selectFiles();
    const preset = getPreset('cn');
    const draft: TranscriptionDraft = {
      inputs,
      modelId: 'large-v3-turbo',
      hardware: {
        mode: 'auto',
        gpuDeviceIndex: 0,
        cudaComputeType: 'float16',
        cpuComputeType: 'int8',
        cpuThreads: 4,
      },
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

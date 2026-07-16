import { describe, expect, it, vi } from 'vitest';

import type { TranscriptionDraft } from '../contracts/desktop';
import { getPreset } from '../data/presets';
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
      basePresetId: 'cn',
      overrides: {},
      effectiveParameters: preset.parameters,
      output: {
        mode: 'compatibility',
        rootDirectory: null,
        txtEnabled: true,
        markdownEnabled: false,
        preserveSourceTxt: true,
        conflictPolicy: 'fail',
      },
    };

    const result = await bridge.startTranscription(draft);

    expect(bridge.mode).toBe('mock');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]?.path).toContain('课程目录');
    expect(result.taskId).toMatch(/^mock-task-/);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.queued',
        task: expect.objectContaining({ sourceCount: 2 }),
      }),
    );

    unlisten();
    bridge.dispose();
  });
});

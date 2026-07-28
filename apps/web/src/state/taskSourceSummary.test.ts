import { describe, expect, it } from 'vitest';

import type { InputSource, TaskSnapshot } from '../contracts/desktop';
import { getPreset } from '../data/presets';
import { taskSourceSummary } from './taskSourceSummary';

function task(inputs: InputSource[], sourceCount: number): TaskSnapshot {
  return {
    id: 'task-summary',
    title: '测试任务',
    sourceCount,
    presetId: 'cn2',
    modelId: 'large-v3-turbo',
    isCustom: false,
    status: 'running',
    progress: 35,
    stage: 'GPU 转录中',
    elapsed: '00:10',
    createdAt: '2026-07-24T10:00:00.000Z',
    draft: {
      inputs,
      modelId: 'large-v3-turbo',
      basePresetId: 'cn2',
      overrides: {},
      effectiveParameters: { ...getPreset('cn2').parameters },
      profileMode: 'transcript',
      subtitleParameters: {
        max_characters_per_line: 18,
        max_lines_per_cue: 1,
        min_cue_duration_ms: 800,
        max_cue_duration_ms: 7000,
        max_characters_per_second: 18,
        cue_gap_ms: 0,
      },
      output: {
        mode: 'compatibility',
        rootDirectory: null,
        txtEnabled: true,
        markdownEnabled: true,
        srtEnabled: false,
        preserveSourceTxt: false,
        preserveSourceMarkdown: false,
        conflictPolicy: 'confirm_overwrite',
      },
      hardware: {
        mode: 'auto',
        gpuDeviceIndex: 0,
        cudaComputeType: 'float16',
        cpuComputeType: 'int8',
        cpuThreads: 4,
      },
    },
  };
}

const file = (path: string): InputSource => ({
  id: path,
  path,
  kind: 'file',
  origin: 'dialog',
  valid: true,
});

describe('taskSourceSummary', () => {
  it('shows only the file name for one file', () => {
    expect(taskSourceSummary(task([file('C:\\Media\\lesson one.mp4')], 1))).toBe('lesson one.mp4');
  });

  it('collapses multiple file paths into one media summary', () => {
    expect(
      taskSourceSummary(task([file('C:\\Media\\one.mp4'), file('D:\\Archive\\two.wav')], 2)),
    ).toBe('多文件路径 · 2 个媒体文件');
  });

  it('shows a folder name and recursive media count', () => {
    expect(
      taskSourceSummary(
        task(
          [
            {
              id: 'folder',
              path: 'E:\\Courses\\July',
              kind: 'directory',
              origin: 'dialog',
              valid: true,
              mediaCount: 8,
            },
          ],
          8,
        ),
      ),
    ).toBe('July · 8 个媒体文件');
  });

  it('labels mixed sources without listing their paths', () => {
    expect(
      taskSourceSummary(
        task(
          [
            file('C:\\Media\\one.mp4'),
            {
              id: 'folder',
              path: 'E:\\Courses\\July',
              kind: 'directory',
              origin: 'dialog',
              valid: true,
              mediaCount: 8,
            },
          ],
          9,
        ),
      ),
    ).toBe('多个输入来源 · 9 个媒体文件');
  });
});

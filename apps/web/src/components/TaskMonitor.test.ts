import { describe, expect, it } from 'vitest';

import type { TaskSnapshot } from '../contracts/desktop';
import { resolveTaskMonitorTarget } from './TaskMonitor';

const COMPLETED_TASK: TaskSnapshot = {
  id: 'completed-task',
  title: '上一轮任务',
  sourceCount: 1,
  presetId: 'cn2',
  modelId: 'large-v3-turbo',
  isCustom: false,
  status: 'completed',
  progress: 100,
  stage: '任务完成',
  elapsed: '00:12',
  createdAt: '2026-09-17T12:00:00+08:00',
};

const INPUT_PREVIEW: TaskSnapshot = {
  ...COMPLETED_TASK,
  id: 'input-task-preview',
  title: '新的待处理输入',
  status: 'queued',
  progress: 0,
  stage: '等待开始',
};

describe('task monitor target', () => {
  it('keeps the monitored completed task when there is no new input preview', () => {
    expect(resolveTaskMonitorTarget([COMPLETED_TASK], COMPLETED_TASK.id, null)).toBe(
      COMPLETED_TASK,
    );
  });

  it('switches to the latest selected-input preview without replacing task history', () => {
    expect(resolveTaskMonitorTarget([COMPLETED_TASK], COMPLETED_TASK.id, INPUT_PREVIEW)).toBe(
      INPUT_PREVIEW,
    );
    expect(COMPLETED_TASK.status).toBe('completed');
  });
});

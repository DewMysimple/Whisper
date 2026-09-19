import { describe, expect, it } from 'vitest';
import type { TaskMediaSnapshot, TaskSnapshot } from '../contracts/desktop';
import {
  currentTaskMedia,
  processedMediaCount,
  taskProcessStep,
  taskProcessStates,
} from './taskMonitor';

const TASK: TaskSnapshot = {
  id: 'monitor',
  title: 'batch',
  sourceCount: 4,
  presetId: 'cn',
  modelId: 'large-v3-turbo',
  isCustom: false,
  status: 'running',
  progress: 90,
  stage: '转录中',
  stageCode: 'transcription.running',
  elapsed: '01:00',
  createdAt: '2026-09-19T00:00:00Z',
};
describe('monitor facts', () => {
  it('matches Windows media paths across case and slash differences', () => {
    const media: TaskMediaSnapshot[] = [
      {
        path: 'D:\\Media\\Lesson.wav',
        status: 'completed',
        progress: 100,
        stage: '已完成',
        elapsedSeconds: 4,
      },
    ];
    expect(
      currentTaskMedia({ ...TASK, status: 'failed', activeInput: 'd:/media/lesson.wav' }, media),
    ).toBe(media[0]);
  });

  it('keeps interrupted stages terminal and does not invent unknown stage history', () => {
    const interrupted = taskProcessStates({
      ...TASK,
      status: 'cancelled',
      stageCode: 'output.writing',
    });
    expect(interrupted.map((step) => step.state)).toEqual([
      'complete',
      'complete',
      'complete',
      'interrupted',
      'pending',
    ]);
    expect(interrupted.map((step) => step.detail)).toEqual([
      '完成',
      '完成',
      '完成',
      '已中断',
      '未执行',
    ]);
    expect(
      taskProcessStates({ ...TASK, status: 'failed', stageCode: undefined }).every(
        (step) => step.detail === '阶段未记录',
      ),
    ).toBe(true);
    expect(
      taskProcessStates({ ...TASK, status: 'queued', stageCode: undefined }).every(
        (step) => step.detail === '待执行',
      ),
    ).toBe(true);
  });
  it('derives the processing stage from the event even on the last file of a batch', () => {
    expect(taskProcessStep(TASK)).toBe(1);
    expect(
      taskProcessStep({
        ...TASK,
        stageCode: 'output.writing',
        stage: '任意展示文字',
        progress: 20,
      }),
    ).toBe(3);
    expect(taskProcessStep({ ...TASK, stageCode: undefined })).toBe(-1);
  });
  it('counts processed files without counting the running file or skipped files outside the processing total', () => {
    const media: TaskMediaSnapshot[] = ['completed', 'failed', 'running', 'pending', 'skipped'].map(
      (status, index) => ({
        path: `C:\\${index}.wav`,
        status: status as TaskMediaSnapshot['status'],
        progress: 0,
        stage: 'test',
        elapsedSeconds: 0,
      }),
    );
    expect(processedMediaCount(media)).toBe(2);
    expect(
      currentTaskMedia({ ...TASK, status: 'cancelled', activeInput: media[2]!.path }, media),
    ).toBe(media[2]);
    const finished = media.map((item) =>
      item.status === 'skipped' ? item : { ...item, status: 'completed' as const },
    );
    expect(
      currentTaskMedia({ ...TASK, status: 'completed', activeInput: undefined }, finished),
    ).toBe(finished[3]);
    expect(currentTaskMedia({ ...TASK, status: 'queued' }, media)).toBeUndefined();
  });
});

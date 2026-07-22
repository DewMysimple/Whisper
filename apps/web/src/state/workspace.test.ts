import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskSnapshot } from '../contracts/desktop';
import { desktopBridge } from '../bridge';
import { getPreset } from '../data/presets';
import { getSubtitlePreset } from '../data/subtitlePresets';

const notification = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('../notifications', () => ({ notifyTaskFinished: notification.notify }));

import { useWorkspace } from './workspace';

const RUNNING_TASK: TaskSnapshot = {
  id: 'task-notification-1',
  title: '访谈 01.mp4',
  sourceCount: 1,
  presetId: 'cn',
  modelId: 'large-v3-turbo',
  isCustom: false,
  status: 'running',
  progress: 20,
  stage: 'GPU 转录中',
  elapsed: '00:10',
  createdAt: '10:00',
};

describe('workspace terminal event notifications', () => {
  beforeEach(() => {
    notification.notify.mockReset().mockResolvedValue(true);
    useWorkspace.setState({
      tasks: [structuredClone(RUNNING_TASK)],
      pendingOverwrite: null,
      startingTask: false,
      lastError: null,
      activeView: 'workspace',
      hostStatus: { state: 'ready', pid: 4242, launchKind: 'mock', error: null },
    });
  });

  it('never treats task progress as cancellation', () => {
    useWorkspace.getState().handleEvent({
      type: 'task.progress',
      taskId: RUNNING_TASK.id,
      progress: 55,
      stage: '文本后处理',
      elapsed: '00:20',
    });

    expect(useWorkspace.getState().tasks[0]).toMatchObject({
      status: 'running',
      progress: 55,
      stage: '文本后处理',
    });
    expect(notification.notify).not.toHaveBeenCalled();
  });

  it('keeps cancellation terminal and ignores duplicate or late completion events', () => {
    useWorkspace.getState().handleEvent({ type: 'task.cancelled', taskId: RUNNING_TASK.id });
    useWorkspace.getState().handleEvent({
      type: 'task.completed',
      taskId: RUNNING_TASK.id,
      elapsed: '00:21',
      outputs: ['D:\\Text\\访谈 01.txt'],
    });
    useWorkspace.getState().handleEvent({ type: 'task.cancelled', taskId: RUNNING_TASK.id });

    expect(useWorkspace.getState().tasks[0]).toMatchObject({
      status: 'cancelled',
      stage: '已取消',
    });
    expect(notification.notify).toHaveBeenCalledTimes(1);
    expect(notification.notify).toHaveBeenCalledWith({
      status: 'cancelled',
      title: '访谈 01.mp4',
      detail: '任务已取消',
    });
  });

  it('classifies completed tasks with missing outputs as abnormal history', async () => {
    const inspect = vi.spyOn(desktopBridge, 'inspectOutputPaths').mockResolvedValue([
      { path: 'D:\\Text\\available.txt', exists: true },
      { path: 'D:\\Text\\moved.txt', exists: false },
    ]);
    useWorkspace.setState({
      tasks: [
        {
          ...RUNNING_TASK,
          id: 'task-available',
          status: 'completed',
          outputs: ['D:\\Text\\available.txt'],
        },
        {
          ...RUNNING_TASK,
          id: 'task-moved',
          status: 'completed',
          outputs: ['D:\\Text\\moved.txt'],
        },
        { ...RUNNING_TASK, id: 'task-running' },
      ],
      outputAuditPending: false,
    });

    await useWorkspace.getState().auditTaskOutputs();

    expect(inspect).toHaveBeenCalledWith(['D:\\Text\\available.txt', 'D:\\Text\\moved.txt']);
    expect(useWorkspace.getState().tasks).toEqual([
      expect.objectContaining({ id: 'task-available', outputAvailability: 'available' }),
      expect.objectContaining({ id: 'task-moved', outputAvailability: 'missing' }),
      expect.objectContaining({ id: 'task-running', status: 'running' }),
    ]);

    useWorkspace.getState().clearAbnormalHistory();
    expect(useWorkspace.getState().tasks.map((task) => task.id)).toEqual([
      'task-available',
      'task-running',
    ]);
    inspect.mockRestore();
  });

  it('deletes only terminal local history and never removes an active task', () => {
    useWorkspace.setState({
      tasks: [
        { ...RUNNING_TASK, id: 'active-task' },
        { ...RUNNING_TASK, id: 'finished-task', status: 'completed' },
      ],
      selectedTaskId: 'finished-task',
      outputPreview: { path: 'D:\\Text\\finished.txt', content: 'done', truncated: false },
      previewLoading: true,
    });

    useWorkspace.getState().deleteTaskHistory('active-task');
    expect(useWorkspace.getState().tasks).toHaveLength(2);

    useWorkspace.getState().deleteTaskHistory('finished-task');
    expect(useWorkspace.getState().tasks.map((task) => task.id)).toEqual(['active-task']);
    expect(useWorkspace.getState()).toMatchObject({
      selectedTaskId: null,
      outputPreview: null,
      previewLoading: false,
    });
  });

  it('keeps the frozen draft on conflict and submits overwrite only after confirmation', async () => {
    const listModels = vi.spyOn(desktopBridge, 'listLocalModels').mockResolvedValue([
      {
        id: 'large-v3-turbo',
        label: 'Large V3 Turbo',
        installed: true,
        path: 'F:\\WhisperSubtitle\\models\\large-v3-turbo',
        sizeBytes: 1,
        detail: 'installed',
      },
    ]);
    const conflict = Object.assign(new Error('conflict'), {
      code: 'output.conflict',
      paths: ['D:\\Text\\sample.txt'],
    });
    const start = vi
      .spyOn(desktopBridge, 'startTranscription')
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ taskId: 'task-overwrite' });
    useWorkspace.setState({
      inputs: [
        {
          id: 'input-conflict',
          path: 'D:\\Media\\sample.wav',
          kind: 'file',
          origin: 'dialog',
          valid: true,
        },
      ],
      selectedModelId: 'large-v3-turbo',
      selectedPresetId: 'cn2',
      profileMode: 'transcript',
      parameters: { ...getPreset('cn2').parameters },
      overrides: {},
      subtitleParameters: { ...getSubtitlePreset('cn2').subtitleParameters },
      subtitleOverrides: {},
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
    });

    await useWorkspace.getState().startTask();
    const pending = useWorkspace.getState().pendingOverwrite;
    expect(pending).toMatchObject({ paths: ['D:\\Text\\sample.txt'], source: 'workspace' });
    expect(useWorkspace.getState().inputs).toHaveLength(1);
    expect(start).toHaveBeenCalledTimes(1);

    await useWorkspace.getState().confirmOverwrite();
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[1]?.[0]).toEqual(pending?.draft);
    expect(start.mock.calls[1]?.[1]).toEqual({ allowOverwrite: true });
    expect(useWorkspace.getState()).toMatchObject({
      pendingOverwrite: null,
      inputs: [],
      activeView: 'performance',
    });
    start.mockRestore();
    listModels.mockRestore();
  });

  it('blocks retry when the frozen hardware is no longer available', async () => {
    const listModels = vi.spyOn(desktopBridge, 'listLocalModels');
    useWorkspace.setState({
      environment: {
        available: true,
        errors: [],
        python: '3.14',
        platform: 'Windows',
        hardware: {
          cpuName: 'Test CPU',
          cpuPhysicalCores: 8,
          cpuLogicalCores: 16,
          cpuComputeTypes: ['int8', 'float32'],
          gpus: [{ index: 0, name: 'GPU 0', computeTypes: ['float16', 'int8_float16'] }],
        },
      },
      tasks: [
        {
          ...RUNNING_TASK,
          id: 'missing-hardware-task',
          status: 'completed',
          draft: {
            inputs: [],
            modelId: 'large-v3-turbo',
            hardware: {
              mode: 'cuda',
              gpuDeviceIndex: 1,
              cudaComputeType: 'float16',
              cpuComputeType: 'int8',
              cpuThreads: 4,
            },
            basePresetId: 'cn',
            profileMode: 'transcript',
            overrides: {},
            effectiveParameters: { ...getPreset('cn').parameters },
            subtitleParameters: { ...getSubtitlePreset('cn').subtitleParameters },
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
          },
        },
      ],
    });

    await useWorkspace.getState().retryTask('missing-hardware-task');

    expect(listModels).not.toHaveBeenCalled();
    expect(useWorkspace.getState()).toMatchObject({
      activeView: 'models',
      lastError: '原任务的硬件配置在当前设备上不可用。',
    });
    listModels.mockRestore();
  });
});

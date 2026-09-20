import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopBridge } from '../bridge';
import type {
  LocalModelDescriptor,
  OutputPathStatus,
  OutputPreview,
  TaskSnapshot,
} from '../contracts/desktop';
import { useWorkspace } from './workspace';

vi.mock('../notifications', () => ({ notifyTaskFinished: vi.fn(), notifyPowerCountdown: vi.fn() }));

const TASK: TaskSnapshot = {
  id: 'integrity-task',
  title: 'lesson.wav',
  sourceCount: 2,
  presetId: 'cn2',
  modelId: 'large-v3-turbo',
  isCustom: false,
  status: 'running',
  progress: 20,
  stage: '转录中',
  elapsed: '00:10',
  taskElapsedSeconds: 10,
  createdAt: '2026-09-19T00:00:00Z',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('workspace task integrity', () => {
  beforeEach(() => {
    useWorkspace.setState({
      ...useWorkspace.getInitialState(),
      tasks: [{ ...TASK }],
      monitoredTaskId: TASK.id,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('previews and locates outputs recorded only on the completed media', async () => {
    const path = 'D:\\Text\\lesson.txt';
    const reveal = vi.spyOn(desktopBridge, 'revealOutput').mockResolvedValue();
    const preview = vi
      .spyOn(desktopBridge, 'readOutputPreview')
      .mockResolvedValue({ path, content: 'transcript', truncated: false });
    useWorkspace.setState({
      tasks: [
        {
          ...TASK,
          status: 'completed',
          outputs: [],
          mediaStates: [
            {
              path: 'D:\\lesson.wav',
              status: 'completed',
              progress: 100,
              stage: '完成',
              elapsedSeconds: 1,
              outputPaths: [path],
            },
          ],
        },
      ],
    });
    await useWorkspace.getState().selectTask(TASK.id);
    expect(preview).toHaveBeenCalledWith(path);
    await useWorkspace.getState().revealTaskOutput(TASK.id);
    expect(reveal).toHaveBeenCalledWith(path);
  });

  it('locks submission before model inspection and preserves input added while awaiting the Host', async () => {
    const modelCheck = deferred<LocalModelDescriptor[]>();
    const list = vi.spyOn(desktopBridge, 'listLocalModels').mockReturnValue(modelCheck.promise);
    const start = vi
      .spyOn(desktopBridge, 'startTranscription')
      .mockResolvedValue({ taskId: 'submitted' });
    const original = {
      id: 'one',
      path: 'C:\\Media\\one.wav',
      kind: 'file' as const,
      origin: 'dialog' as const,
      valid: true,
    };
    const added = { ...original, id: 'two', path: 'C:\\Media\\two.wav' };
    useWorkspace.setState({
      inputs: [original],
      hostStatus: { state: 'ready', pid: 1, launchKind: 'mock', error: null },
    });
    const first = useWorkspace.getState().startTask();
    await useWorkspace.getState().startTask();
    expect(list).toHaveBeenCalledTimes(1);
    expect(useWorkspace.getState().startingTask).toBe(true);
    useWorkspace.getState().handleEvent({ type: 'inputs.added', inputs: [added] });
    modelCheck.resolve([
      { id: useWorkspace.getState().selectedModelId, installed: true } as LocalModelDescriptor,
    ]);
    await first;
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]![0].inputs).toEqual([original]);
    expect(useWorkspace.getState().inputs).toEqual([added]);
    expect(useWorkspace.getState().startingTask).toBe(false);
  });

  it('does not let duplicate queue or late progress events resurrect or select a terminal task', () => {
    const terminal = { ...TASK, status: 'cancelled' as const };
    const active = { ...TASK, id: 'new-task' };
    useWorkspace.setState({ tasks: [active, terminal], monitoredTaskId: active.id });
    useWorkspace
      .getState()
      .handleEvent({ type: 'task.queued', task: { ...TASK, status: 'queued' } });
    for (const taskId of [TASK.id, 'unknown-task']) {
      useWorkspace.getState().handleEvent({
        type: 'task.progress',
        taskId,
        progress: 90,
        stage: '转录中',
        elapsed: '00:20',
      });
    }
    expect(useWorkspace.getState().tasks).toEqual([active, terminal]);
    expect(useWorkspace.getState().monitoredTaskId).toBe(active.id);
  });

  it('terminates active and queued records when the Host loses the Worker, retaining outputs', () => {
    useWorkspace.setState({
      tasks: [
        { ...TASK, outputs: ['C:\\Text\\one.txt'] },
        { ...TASK, id: 'queued', status: 'queued' },
        { ...TASK, id: 'finished', status: 'completed' },
      ],
    });
    useWorkspace.getState().handleEvent({
      type: 'host.status',
      status: {
        state: 'failed',
        pid: 1,
        launchKind: 'development-python',
        error: 'disconnected',
      },
    });
    expect(useWorkspace.getState().tasks.map((task) => task.status)).toEqual([
      'failed',
      'failed',
      'completed',
    ]);
    expect(useWorkspace.getState().tasks[0]?.outputs).toEqual(['C:\\Text\\one.txt']);
    expect(useWorkspace.getState().tasks[0]?.errorCode).toBe('host.worker_disconnected');
  });

  it('does not infer successful media from a later file index or partial completion', () => {
    useWorkspace.setState({ tasks: [{ ...TASK, mediaPaths: ['C:\\one.wav', 'C:\\two.wav'] }] });
    useWorkspace.getState().handleEvent({
      type: 'task.progress',
      taskId: TASK.id,
      progress: 70,
      stage: '转录中',
      elapsed: '00:15',
      inputPath: 'C:\\two.wav',
      mediaIndex: 2,
      mediaStatus: 'failed',
    });
    expect(useWorkspace.getState().tasks[0]?.mediaStates?.[0]?.status).toBe('pending');
    useWorkspace.getState().handleEvent({
      type: 'task.completed',
      taskId: TASK.id,
      elapsed: '00:21',
      outputs: [],
      failureCount: 2,
    });
    expect(useWorkspace.getState().tasks[0]).toMatchObject({
      status: 'failed',
      taskElapsedSeconds: 21,
    });
    expect(
      useWorkspace.getState().tasks[0]?.mediaStates?.every((media) => media.status === 'failed'),
    ).toBe(true);
  });

  it('applies an output audit only to the records and paths actually inspected', async () => {
    const audit = deferred<OutputPathStatus[]>();
    vi.spyOn(desktopBridge, 'inspectOutputPaths').mockReturnValue(audit.promise);
    useWorkspace.setState({
      tasks: [{ ...TASK, id: 'old', status: 'completed', outputs: ['C:\\old.txt'] }, TASK],
    });
    const request = useWorkspace.getState().auditTaskOutputs();
    useWorkspace.getState().handleEvent({
      type: 'task.completed',
      taskId: TASK.id,
      elapsed: '00:20',
      outputs: ['C:\\new.txt'],
    });
    audit.resolve([{ path: 'C:\\old.txt', exists: true }]);
    await request;
    expect(
      useWorkspace.getState().tasks.find((task) => task.id === TASK.id)?.outputAvailability,
    ).toBe('available');
    useWorkspace.getState().clearAbnormalHistory();
    expect(useWorkspace.getState().tasks).toHaveLength(2);
  });

  it('keeps an existing output healthy when its preview fails for a non-file reason', async () => {
    vi.spyOn(desktopBridge, 'readOutputPreview').mockRejectedValue(new Error('permission denied'));
    vi.spyOn(desktopBridge, 'inspectOutputPaths').mockResolvedValue([
      { path: 'C:\\one.txt', exists: true },
    ]);
    useWorkspace.setState({ tasks: [{ ...TASK, status: 'completed', outputs: ['C:\\one.txt'] }] });
    await useWorkspace.getState().selectTask(TASK.id);
    expect(useWorkspace.getState().tasks[0]?.outputAvailability).toBe('available');
    expect(useWorkspace.getState().lastError).toBe('permission denied');
  });

  it('ignores the first preview response after closing and reopening the same task', async () => {
    const oldPreview = deferred<OutputPreview>();
    const newPreview = deferred<OutputPreview>();
    vi.spyOn(desktopBridge, 'readOutputPreview')
      .mockReturnValueOnce(oldPreview.promise)
      .mockReturnValueOnce(newPreview.promise);
    useWorkspace.setState({ tasks: [{ ...TASK, status: 'completed', outputs: ['C:\\one.txt'] }] });
    const first = useWorkspace.getState().selectTask(TASK.id);
    await useWorkspace.getState().selectTask(null);
    const second = useWorkspace.getState().selectTask(TASK.id);
    newPreview.resolve({ path: 'C:\\one.txt', content: 'new', truncated: false });
    await second;
    oldPreview.resolve({ path: 'C:\\one.txt', content: 'old', truncated: false });
    await first;
    expect(useWorkspace.getState().outputPreview?.content).toBe('new');
  });
});

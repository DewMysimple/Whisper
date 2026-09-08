import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskSnapshot } from '../contracts/desktop';
import { desktopBridge } from '../bridge';
import { getPreset } from '../data/presets';
import { getSubtitlePreset } from '../data/subtitlePresets';

const notification = vi.hoisted(() => ({ notify: vi.fn(), notifyPower: vi.fn() }));

vi.mock('../notifications', () => ({
  notifyTaskFinished: notification.notify,
  notifyPowerCountdown: notification.notifyPower,
}));

import { canResumeTask, useWorkspace } from './workspace';

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
    notification.notifyPower.mockReset().mockResolvedValue(true);
    useWorkspace.setState({
      tasks: [structuredClone(RUNNING_TASK)],
      pendingOverwrite: null,
      pendingShutdownStart: null,
      startingTask: false,
      lastError: null,
      logs: [],
      activeView: 'workspace',
      powerActionStatus: {
        state: 'idle',
        action: null,
        executeAtEpochMs: null,
        error: null,
      },
      shutdownArmed: false,
      hostStatus: { state: 'ready', pid: 4242, launchKind: 'mock', error: null },
    });
  });

  it('keeps the full session log beyond 200 lines and clears only on the Host event', () => {
    for (let index = 0; index < 205; index += 1) {
      useWorkspace.getState().handleEvent({
        type: 'worker.log',
        line: `line ${index}`,
      });
    }
    expect(useWorkspace.getState().logs).toHaveLength(205);
    expect(useWorkspace.getState().logs.at(-1)).toBe('line 204');

    useWorkspace.getState().handleEvent({ type: 'worker.logs_cleared' });
    expect(useWorkspace.getState().logs).toEqual([]);
  });

  it('keeps parameter overrides isolated by V3 model and preset', async () => {
    useWorkspace.setState({
      tasks: [],
      selectedModelId: 'large-v3-turbo',
      selectedPresetId: 'en_v1',
      profileMode: 'transcript',
      parameters: { ...getPreset('en_v1', 'large-v3-turbo').parameters },
      overrides: {},
      parameterProfiles: {},
      localModels: [
        {
          id: 'large-v3',
          label: 'Large V3',
          installed: true,
          path: 'D:\\models\\large-v3',
          sizeBytes: 1,
          detail: 'ready',
        },
        {
          id: 'large-v3-turbo',
          label: 'Large V3 Turbo',
          installed: true,
          path: 'D:\\models\\large-v3-turbo',
          sizeBytes: 1,
          detail: 'ready',
        },
      ],
    });

    useWorkspace.getState().setParameter('beam_size', 7);
    useWorkspace.getState().selectProfile('transcript', 'en_v2');
    expect(useWorkspace.getState().parameters.beam_size).toBe(5);
    useWorkspace.getState().selectProfile('transcript', 'en_v1');
    expect(useWorkspace.getState().parameters.beam_size).toBe(7);

    await useWorkspace.getState().selectModel('large-v3');
    expect(useWorkspace.getState().parameters.beam_size).toBe(5);
    useWorkspace.getState().setParameter('beam_size', 9);
    await useWorkspace.getState().selectModel('large-v3-turbo');
    expect(useWorkspace.getState().parameters.beam_size).toBe(7);
  });

  it('freezes explicit zero temperature and rejects unsupported translation combinations', () => {
    useWorkspace.setState({
      selectedModelId: 'large-v3-turbo',
      selectedPresetId: 'en_v1',
      parameters: { ...getPreset('en_v1', 'large-v3-turbo').parameters },
      overrides: {},
      parameterProfiles: {},
      lastError: null,
    });

    useWorkspace.getState().setTemperatureMode('fixed');
    expect(useWorkspace.getState().overrides).toHaveProperty('temperature', 0);
    useWorkspace.getState().setTemperatureMode('model');
    expect(useWorkspace.getState().overrides).not.toHaveProperty('temperature');

    useWorkspace.getState().setParameter('task', 'translate');
    expect(useWorkspace.getState().parameters.task).toBe('transcribe');
    expect(useWorkspace.getState().lastError).toMatch(/Turbo/);

    useWorkspace.setState({
      selectedModelId: 'large-v3',
      parameters: { ...getPreset('en_v1', 'large-v3').parameters },
      overrides: {},
      lastError: null,
    });
    useWorkspace.getState().setParameter('task', 'translate');
    expect(useWorkspace.getState().parameters.task).toBe('translate');

    useWorkspace.getState().selectProfile('transcript', 'cn2');
    useWorkspace.getState().setParameter('task', 'translate');
    expect(useWorkspace.getState().parameters.task).toBe('transcribe');
    expect(useWorkspace.getState().lastError).toMatch(/仅在英文/);
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

  it('updates real per-media progress and elapsed time without inventing other files', () => {
    useWorkspace.setState({
      tasks: [
        {
          ...RUNNING_TASK,
          sourceCount: 2,
          mediaPaths: ['D:\\Media\\one.mp4', 'D:\\Media\\two.mp4'],
          processingCount: 2,
          mediaStates: [
            {
              path: 'D:\\Media\\one.mp4',
              status: 'pending',
              progress: 0,
              stage: '等待处理',
              elapsedSeconds: 0,
            },
            {
              path: 'D:\\Media\\two.mp4',
              status: 'pending',
              progress: 0,
              stage: '等待处理',
              elapsedSeconds: 0,
            },
          ],
        },
      ],
    });

    useWorkspace.getState().handleEvent({
      type: 'task.progress',
      taskId: RUNNING_TASK.id,
      progress: 44,
      stage: 'GPU 转录中',
      elapsed: '00:27',
      inputPath: 'D:\\Media\\two.mp4',
      mediaIndex: 2,
      mediaTotal: 2,
      mediaProgress: 37.5,
      mediaElapsedSeconds: 8.25,
      taskElapsedSeconds: 27,
      mediaStatus: 'running',
      outputPaths: ['D:\\Text\\two.txt'],
    });

    const task = useWorkspace.getState().tasks[0]!;
    expect(task).toMatchObject({
      currentMediaIndex: 2,
      taskElapsedSeconds: 27,
      activeInput: 'D:\\Media\\two.mp4',
    });
    expect(task.mediaStates).toEqual([
      expect.objectContaining({ path: 'D:\\Media\\one.mp4', status: 'completed', progress: 100 }),
      expect.objectContaining({
        path: 'D:\\Media\\two.mp4',
        status: 'running',
        progress: 37.5,
        elapsedSeconds: 8.25,
        outputPaths: ['D:\\Text\\two.txt'],
      }),
    ]);
    expect(task.outputs).toEqual(['D:\\Text\\two.txt']);
    expect(useWorkspace.getState().monitoredTaskId).toBe(RUNNING_TASK.id);
  });

  it('stores bounded real recognition diagnostics on the matching media', () => {
    const segments = Array.from({ length: 18 }, (_, index) => ({
      index,
      start: index,
      end: index + 1,
      text: `segment ${index}`,
      temperature: 0.4,
      avgLogProbability: -1.2,
      compressionRatio: 2.5,
      noSpeechProbability: 0.1,
      reasons: ['fallback_temperature' as const],
    }));
    const languageRegions = Array.from({ length: 18 }, (_, index) => ({
      start: index,
      end: index + 1,
      topLanguage: 'en',
      topProbability: 0.9,
      englishProbability: 0.9,
      chineseProbability: 0.03,
      primaryText: `原文 ${index}`,
      candidateText: `candidate ${index}`,
      decision: 'review' as const,
      reason: 'unsafe_boundary',
    }));
    const detailCandidates = Array.from({ length: 18 }, (_, index) => ({
      start: index,
      end: index + 1,
      chineseProbability: 0.94,
      primaryText: `拟太 ${index}`,
      candidateText: `拟态 ${index}`,
      decision: 'review' as const,
      reason: 'insufficient_confidence_gain',
      primaryWordProbability: 0.6,
      candidateWordProbability: 0.65,
      primaryLogProbability: -0.9,
      candidateLogProbability: -0.85,
      recoveredHotwords: [] as string[],
    }));
    useWorkspace.setState({
      tasks: [
        {
          ...RUNNING_TASK,
          mediaPaths: ['D:\\Media\\one.mp4'],
          mediaStates: [
            {
              path: 'D:\\Media\\one.mp4',
              status: 'running',
              progress: 50,
              stage: 'GPU 转录中',
              elapsedSeconds: 5,
            },
          ],
        },
      ],
    });

    useWorkspace.getState().handleEvent({
      type: 'task.progress',
      taskId: RUNNING_TASK.id,
      progress: 70,
      stage: 'GPU 转录中',
      elapsed: '00:10',
      inputPath: 'D:\\Media\\one.mp4',
      qualityDiagnostics: {
        detectedLanguage: 'zh',
        languageProbability: 0.92,
        segmentCount: 18,
        fallbackSegmentCount: 18,
        maxTemperature: 0.4,
        lowConfidenceCount: 18,
        segments,
        recognitionStrategy: 'mixed_zh_en',
        languageRegions,
        detailCandidates,
      },
    });

    const diagnostics = useWorkspace.getState().tasks[0]!.mediaStates![0]!.qualityDiagnostics!;
    expect(diagnostics.segments).toHaveLength(12);
    expect(diagnostics.languageRegions).toHaveLength(12);
    expect(diagnostics.detailCandidates).toHaveLength(12);
    expect(diagnostics.omittedSegmentCount).toBe(6);
    expect(diagnostics.lowConfidenceCount).toBe(18);
  });

  it('retains a terminal monitor until the next task emits real progress', () => {
    useWorkspace.setState({
      monitoredTaskId: RUNNING_TASK.id,
      taskWorkspaceMode: 'monitor',
      activeView: 'tasks',
    });

    useWorkspace.getState().handleEvent({
      type: 'task.completed',
      taskId: RUNNING_TASK.id,
      elapsed: '00:21',
      outputs: ['D:\\Text\\finished.txt'],
    });
    expect(useWorkspace.getState().monitoredTaskId).toBe(RUNNING_TASK.id);

    const queuedTask: TaskSnapshot = {
      ...RUNNING_TASK,
      id: 'task-next',
      title: 'next.mp4',
      status: 'queued',
      progress: 0,
      stage: '等待 Worker',
    };
    useWorkspace.getState().handleEvent({ type: 'task.queued', task: queuedTask });
    expect(useWorkspace.getState().monitoredTaskId).toBe(RUNNING_TASK.id);

    useWorkspace.getState().handleEvent({
      type: 'task.progress',
      taskId: queuedTask.id,
      progress: 1,
      stage: '正在转录',
      elapsed: '00:00',
    });
    expect(useWorkspace.getState().monitoredTaskId).toBe(queuedTask.id);
  });

  it('uses exactly one combined completion notice when a shutdown countdown begins', () => {
    useWorkspace.getState().handleEvent({
      type: 'power.action',
      status: {
        state: 'countdown',
        action: 'shutdown',
        executeAtEpochMs: Date.now() + 60_000,
        error: null,
      },
    });
    useWorkspace.getState().handleEvent({
      type: 'task.completed',
      taskId: RUNNING_TASK.id,
      elapsed: '04:27',
      outputs: ['D:\\Text\\访谈 01.txt'],
    });

    expect(notification.notifyPower).toHaveBeenCalledOnce();
    expect(notification.notifyPower).toHaveBeenCalledWith('04:27');
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
      elapsed: '00:10',
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

  it('opens the next surviving output directory when an earlier path disappears', async () => {
    const first = 'D:\\Text\\first.txt';
    const second = 'D:\\Text\\second.txt';
    const inspect = vi.spyOn(desktopBridge, 'inspectOutputPaths').mockResolvedValue([
      { path: first, exists: true },
      { path: second, exists: true },
    ]);
    const open = vi
      .spyOn(desktopBridge, 'openOutputDirectory')
      .mockRejectedValueOnce(new Error('first path moved'))
      .mockResolvedValueOnce();
    useWorkspace.setState({
      tasks: [
        {
          ...RUNNING_TASK,
          id: 'task-output-directory',
          status: 'completed',
          outputs: [first, second],
        },
      ],
    });

    await useWorkspace.getState().openTaskOutputDirectory('task-output-directory');

    expect(inspect).toHaveBeenCalledWith([first, second]);
    expect(open.mock.calls.map(([path]) => path)).toEqual([first, second]);
    expect(useWorkspace.getState().lastError).toBeNull();
    open.mockRestore();
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

  it('freezes a shutdown draft and submits it only after explicit confirmation', async () => {
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
    const start = vi
      .spyOn(desktopBridge, 'startTranscription')
      .mockResolvedValue({ taskId: 'task-shutdown' });
    useWorkspace.setState({
      inputs: [
        {
          id: 'input-shutdown',
          path: 'D:\\Media\\shutdown.wav',
          kind: 'file',
          origin: 'dialog',
          valid: true,
        },
      ],
      finishAction: 'shutdown',
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
    const frozen = useWorkspace.getState().pendingShutdownStart?.draft;
    expect(frozen).toBeDefined();
    expect(start).not.toHaveBeenCalled();
    expect(useWorkspace.getState().inputs).toHaveLength(1);

    useWorkspace.getState().cancelShutdownStart();
    expect(useWorkspace.getState()).toMatchObject({
      pendingShutdownStart: null,
      finishAction: 'shutdown',
    });

    await useWorkspace.getState().startTask();
    await useWorkspace.getState().confirmShutdownStart();
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(frozen, { finishAction: 'shutdown' });
    expect(useWorkspace.getState()).toMatchObject({
      pendingShutdownStart: null,
      inputs: [],
      finishAction: 'none',
      activeView: 'performance',
    });
    start.mockRestore();
    listModels.mockRestore();
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
    expect(start.mock.calls[1]?.[1]).toEqual({
      allowOverwrite: true,
      skipConflicts: false,
      finishAction: 'none',
    });
    expect(useWorkspace.getState()).toMatchObject({
      pendingOverwrite: null,
      inputs: [],
      activeView: 'performance',
    });
    start.mockRestore();
    listModels.mockRestore();
  });

  it('submits the exact en_v2 preset selected in the transcription panel', async () => {
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
    const start = vi
      .spyOn(desktopBridge, 'startTranscription')
      .mockResolvedValue({ taskId: 'task-en-v2' });
    useWorkspace.setState({
      inputs: [
        {
          id: 'input-en-v2',
          path: 'D:\\Media\\english.wav',
          kind: 'file',
          origin: 'dialog',
          valid: true,
        },
      ],
      selectedModelId: 'large-v3-turbo',
      hardwarePreference: {
        mode: 'auto',
        gpuDeviceIndex: 0,
        cudaComputeType: 'float16',
        cpuComputeType: 'int8',
        cpuThreads: 4,
      },
      environment: null,
      selectedPresetId: 'en_v2',
      profileMode: 'transcript',
      parameters: { ...getPreset('en_v2').parameters },
      overrides: {},
      subtitleParameters: { ...getSubtitlePreset('en_v2').subtitleParameters },
      subtitleOverrides: {},
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
    });

    await useWorkspace.getState().startTask();

    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[0]).toMatchObject({
      basePresetId: 'en_v2',
      profileMode: 'transcript',
      effectiveParameters: expect.objectContaining({
        condition_on_previous_text: false,
      }),
    });
    start.mockRestore();
    listModels.mockRestore();
  });

  it('restores frozen hardware for editing without starting or loading a model', async () => {
    const listModels = vi.spyOn(desktopBridge, 'listLocalModels');
    const start = vi.spyOn(desktopBridge, 'startTranscription');
    const inspect = vi.spyOn(desktopBridge, 'inspectPaths').mockResolvedValue([]);
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
    expect(start).not.toHaveBeenCalled();
    expect(useWorkspace.getState()).toMatchObject({
      activeView: 'workspace',
      lastError: null,
      hardwarePreference: {
        mode: 'cuda',
        gpuDeviceIndex: 1,
      },
    });
    inspect.mockRestore();
    start.mockRestore();
    listModels.mockRestore();
  });

  it('resumes only unfinished media while preserving completed output paths', async () => {
    const completedPath = 'D:\\Media\\one.mp4';
    const remainingPath = 'D:\\Media\\two.mp4';
    const completedOutput = 'D:\\Text\\one.txt';
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
    const inspectOutputs = vi
      .spyOn(desktopBridge, 'inspectOutputPaths')
      .mockResolvedValue([{ path: completedOutput, exists: true }]);
    const inspectInputs = vi.spyOn(desktopBridge, 'inspectPaths').mockResolvedValue([
      {
        id: 'remaining-input',
        path: remainingPath,
        kind: 'file',
        origin: 'manual',
        valid: true,
      },
    ]);
    const start = vi
      .spyOn(desktopBridge, 'startTranscription')
      .mockResolvedValue({ taskId: 'task-resumed' });
    const task: TaskSnapshot = {
      ...RUNNING_TASK,
      id: 'task-partial',
      status: 'cancelled',
      sourceCount: 2,
      mediaPaths: [completedPath, remainingPath],
      mediaStates: [
        {
          path: completedPath,
          status: 'completed',
          progress: 100,
          stage: '已完成',
          elapsedSeconds: 5,
          outputPaths: [completedOutput],
        },
        {
          path: remainingPath,
          status: 'running',
          progress: 42,
          stage: '正在转录',
          elapsedSeconds: 3,
        },
      ],
      draft: {
        inputs: [
          {
            id: 'original-folder',
            path: 'D:\\Media',
            kind: 'directory',
            origin: 'dialog',
            valid: true,
            mediaCount: 2,
          },
        ],
        modelId: 'large-v3-turbo',
        recognitionStrategy: 'mixed_zh_en',
        hardware: {
          mode: 'auto',
          gpuDeviceIndex: 0,
          cudaComputeType: 'float16',
          cpuComputeType: 'int8',
          cpuThreads: 4,
        },
        basePresetId: 'cn2',
        profileMode: 'transcript',
        overrides: {},
        effectiveParameters: { ...getPreset('cn2').parameters },
        subtitleParameters: { ...getSubtitlePreset('cn2').subtitleParameters },
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
    };
    useWorkspace.setState({
      tasks: [task],
      hostStatus: { state: 'ready', pid: 4242, launchKind: 'mock', error: null },
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
    });

    expect(canResumeTask(task)).toBe(true);
    await useWorkspace.getState().resumeTask(task.id);

    expect(inspectOutputs).toHaveBeenCalledWith([completedOutput]);
    expect(inspectInputs).toHaveBeenCalledWith([remainingPath], 'manual');
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[0].inputs).toEqual([
      expect.objectContaining({ path: remainingPath }),
    ]);
    expect(start.mock.calls[0]?.[0].inputs).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: completedPath })]),
    );
    expect(start.mock.calls[0]?.[1]).toBeUndefined();
    expect(start.mock.calls[0]?.[0].recognitionStrategy).toBe('stable_primary');
    expect(useWorkspace.getState()).toMatchObject({
      activeView: 'performance',
      finishAction: 'none',
      lastError: null,
    });

    start.mockRestore();
    inspectInputs.mockRestore();
    inspectOutputs.mockRestore();
    listModels.mockRestore();
  });

  it('reprocesses a completed media item when its recorded output has disappeared', async () => {
    const completedPath = 'D:\\Media\\one.mp4';
    const failedPath = 'D:\\Media\\two.mp4';
    const missingOutput = 'D:\\Text\\one.txt';
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
    vi.spyOn(desktopBridge, 'inspectOutputPaths').mockResolvedValue([
      { path: missingOutput, exists: false },
    ]);
    const inspectInputs = vi.spyOn(desktopBridge, 'inspectPaths').mockResolvedValue(
      [completedPath, failedPath].map((path, index) => ({
        id: `input-${index}`,
        path,
        kind: 'file' as const,
        origin: 'manual' as const,
        valid: true,
      })),
    );
    const start = vi
      .spyOn(desktopBridge, 'startTranscription')
      .mockResolvedValue({ taskId: 'task-resumed-missing' });
    const draft = {
      inputs: [],
      modelId: 'large-v3-turbo' as const,
      hardware: {
        mode: 'auto' as const,
        gpuDeviceIndex: 0,
        cudaComputeType: 'float16' as const,
        cpuComputeType: 'int8' as const,
        cpuThreads: 4,
      },
      basePresetId: 'cn2' as const,
      profileMode: 'transcript' as const,
      overrides: {},
      effectiveParameters: { ...getPreset('cn2').parameters },
      subtitleParameters: { ...getSubtitlePreset('cn2').subtitleParameters },
      output: {
        mode: 'compatibility' as const,
        rootDirectory: null,
        txtEnabled: true,
        markdownEnabled: false,
        srtEnabled: false,
        preserveSourceTxt: false,
        preserveSourceMarkdown: false,
        conflictPolicy: 'confirm_overwrite' as const,
      },
    };
    useWorkspace.setState({
      tasks: [
        {
          ...RUNNING_TASK,
          id: 'task-missing-completed-output',
          status: 'failed',
          sourceCount: 2,
          mediaStates: [
            {
              path: completedPath,
              status: 'completed',
              progress: 100,
              stage: '已完成',
              elapsedSeconds: 5,
              outputPaths: [missingOutput],
            },
            {
              path: failedPath,
              status: 'failed',
              progress: 10,
              stage: '失败',
              elapsedSeconds: 1,
            },
          ],
          draft,
        },
      ],
      hostStatus: { state: 'ready', pid: 4242, launchKind: 'mock', error: null },
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
          gpus: [{ index: 0, name: 'GPU 0', computeTypes: ['float16'] }],
        },
      },
    });

    await useWorkspace.getState().resumeTask('task-missing-completed-output');

    expect(inspectInputs).toHaveBeenCalledWith([completedPath, failedPath], 'manual');
    expect(start.mock.calls[0]?.[0].inputs.map((input) => input.path)).toEqual([
      completedPath,
      failedPath,
    ]);

    start.mockRestore();
    inspectInputs.mockRestore();
    vi.mocked(desktopBridge.inspectOutputPaths).mockRestore();
    listModels.mockRestore();
  });
});

describe('workspace inference controls while tasks are active', () => {
  beforeEach(() => {
    useWorkspace.setState({
      tasks: [structuredClone(RUNNING_TASK)],
      selectedModelId: 'large-v3-turbo',
      localModels: [
        {
          id: 'base',
          label: 'Base',
          installed: true,
          path: 'F:\\Models\\base',
          sizeBytes: 1,
          detail: '已安装',
        },
      ],
      hardwarePreference: {
        mode: 'auto',
        gpuDeviceIndex: 0,
        cudaComputeType: 'float16',
        cpuComputeType: 'int8',
        cpuThreads: 4,
      },
      pendingModelId: null,
      pendingHardware: false,
      lastError: null,
    });
  });

  it('rejects model changes while a task is running', async () => {
    await useWorkspace.getState().selectModel('base');

    expect(useWorkspace.getState().selectedModelId).toBe('large-v3-turbo');
    expect(useWorkspace.getState().pendingModelId).toBeNull();
    expect(useWorkspace.getState().lastError).toContain('不能切换模型');
  });

  it('rejects hardware changes while a task is running', async () => {
    await useWorkspace.getState().setHardwarePreference({
      mode: 'cpu',
      gpuDeviceIndex: 0,
      cudaComputeType: 'float16',
      cpuComputeType: 'float32',
      cpuThreads: 2,
    });

    expect(useWorkspace.getState().hardwarePreference.mode).toBe('auto');
    expect(useWorkspace.getState().pendingHardware).toBe(false);
    expect(useWorkspace.getState().lastError).toContain('不能更改硬件配置');
  });
});

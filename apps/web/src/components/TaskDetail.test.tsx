import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { RecognitionQualityDiagnostics, TaskSnapshot } from '../contracts/desktop';
import { useWorkspace } from '../state/workspace';
import { TaskDetail } from './TaskDetail';

beforeEach(() =>
  useWorkspace.setState({
    ...useWorkspace.getInitialState(),
    selectedTaskId: null,
    outputPreview: null,
    previewLoading: false,
  }),
);

it('resets the restore confirmation when switching or closing task details', async () => {
  const base = useWorkspace.getState().tasks.find((task) => task.draft)!;
  expect(base.draft).toBeDefined();
  const first = { ...base, id: 'first', title: 'first.wav', status: 'completed' as const };
  const second = { ...first, id: 'second', title: 'second.wav' };
  const retry = vi.fn().mockResolvedValue(undefined);
  useWorkspace.setState({ tasks: [first, second], selectedTaskId: first.id, retryTask: retry });
  const user = userEvent.setup();
  render(<TaskDetail />);
  await user.click(screen.getByRole('button', { name: '载入原配置' }));
  expect(screen.getByRole('dialog', { name: '载入历史转录配置' })).toHaveTextContent('first.wav');
  act(() => useWorkspace.setState({ selectedTaskId: second.id }));
  expect(screen.queryByRole('dialog', { name: '载入历史转录配置' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '载入原配置' }));
  await user.click(
    within(screen.getByRole('dialog', { name: '载入历史转录配置' })).getByRole('button', {
      name: '载入原配置',
    }),
  );
  expect(retry).toHaveBeenCalledWith(second.id);
  expect(retry).toHaveBeenCalledTimes(1);
  act(() => useWorkspace.setState({ selectedTaskId: null }));
  act(() => useWorkspace.setState({ selectedTaskId: first.id }));
  expect(screen.queryByRole('dialog', { name: '载入历史转录配置' })).not.toBeInTheDocument();
});

const cleanDiagnostics: RecognitionQualityDiagnostics = {
  detectedLanguage: 'zh',
  languageProbability: null,
  segmentCount: 1,
  fallbackSegmentCount: 0,
  maxTemperature: 0,
  lowConfidenceCount: 0,
  segments: [],
  hotwordAudit: {
    termCount: 2,
    matchedCount: 1,
    missingCount: 1,
    matchedTerms: ['拟态'],
    missingTerms: ['李普曼'],
    omittedTermCount: 0,
  },
};

function showQualityTask(
  modelId: TaskSnapshot['modelId'],
  diagnostics: RecognitionQualityDiagnostics | undefined,
  status: TaskSnapshot['status'] = 'completed',
) {
  const task = useWorkspace.getState().tasks[0]!;
  useWorkspace.setState({
    tasks: [
      {
        ...task,
        modelId,
        status,
        mediaStates: [
          {
            path: 'C:\\Media\\lecture.wav',
            status: status === 'completed' ? 'completed' : 'pending',
            progress: status === 'completed' ? 100 : 0,
            stage: '',
            elapsedSeconds: 1,
            ...(diagnostics ? { qualityDiagnostics: diagnostics } : {}),
          },
        ],
      },
    ],
    selectedTaskId: task.id,
  });
  render(<TaskDetail />);
}

it.each(['qwen3-asr-0.6b', 'qwen3-asr-1.7b'] as const)(
  'does not assess legacy zero decode diagnostics for %s, while preserving language and terms',
  (modelId) => {
    showQualityTask(modelId, cleanDiagnostics);
    expect(screen.getByText('当前模型未提供这些解码质量指标。')).toBeInTheDocument();
    expect(screen.queryByText('已诊断媒体')).not.toBeInTheDocument();
    expect(screen.queryByText(/最高温度/)).not.toBeInTheDocument();
    expect(screen.queryByText('需复核片段')).not.toBeInTheDocument();
    expect(screen.queryByText('温度回退片段')).not.toBeInTheDocument();
    expect(screen.getByText(/主语言 zh/)).toBeInTheDocument();
    expect(screen.getByText('已命中：拟态')).toBeInTheDocument();
    expect(screen.getByText('未在结果中出现：李普曼')).toBeInTheDocument();
  },
);

it('keeps an evaluated clean Whisper result distinct from unavailable diagnostics', () => {
  showQualityTask('large-v3-turbo', cleanDiagnostics);
  expect(screen.getByText('已诊断媒体')).toHaveTextContent('1');
  expect(screen.getByText('需复核片段')).toHaveTextContent('0');
  expect(screen.getByText('温度回退片段')).toHaveTextContent('0');
  expect(screen.getByText(/最高温度 0.0/)).toBeInTheDocument();
  expect(screen.getByText('未发现触发复核规则的片段。')).toBeInTheDocument();
});

it('shows real Whisper suspicious segments and the review disclaimer', () => {
  showQualityTask('large-v3-turbo', {
    ...cleanDiagnostics,
    lowConfidenceCount: 1,
    fallbackSegmentCount: 1,
    maxTemperature: 0.4,
    segments: [
      {
        index: 0,
        start: 0,
        end: 1,
        text: '可疑片段',
        temperature: 0.4,
        avgLogProbability: -1.2,
        compressionRatio: 2.6,
        noSpeechProbability: 0.05,
        reasons: ['fallback_temperature', 'low_log_probability'],
      },
    ],
  });
  expect(screen.getByText('需复核片段')).toHaveTextContent('1');
  expect(screen.getByText('温度回退片段')).toHaveTextContent('1');
  expect(screen.getByText('可疑片段')).toBeInTheDocument();
  expect(screen.getByText(/不等同于已经识别错误/)).toBeInTheDocument();
  expect(screen.queryByText('未发现触发复核规则的片段。')).not.toBeInTheDocument();
});

it.each(['completed', 'queued', 'running'] as const)(
  'does not count a %s Whisper task with no diagnostic information as assessed',
  (status) => {
    showQualityTask('large-v3-turbo', undefined, status);
    expect(screen.getByText('旧任务或尚未完成识别的媒体没有质量诊断。')).toBeInTheDocument();
    expect(screen.queryByText('已诊断媒体')).not.toBeInTheDocument();
    expect(screen.queryByText(/最高温度/)).not.toBeInTheDocument();
  },
);

it('explains unsupported Qwen metrics before recognition while retaining the pending state', () => {
  showQualityTask('qwen3-asr-0.6b', undefined, 'queued');
  expect(screen.getByText('当前模型未提供这些解码质量指标。')).toBeInTheDocument();
  expect(screen.getByText('旧任务或尚未完成识别的媒体没有质量诊断。')).toBeInTheDocument();
  expect(screen.queryByText('已诊断媒体')).not.toBeInTheDocument();
});

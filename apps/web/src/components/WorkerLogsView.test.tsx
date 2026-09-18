import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useWorkspace } from '../state/workspace';
import { parseWorkerLogLine, WorkerLogsView } from './WorkerLogsView';

describe('WorkerLogsView', () => {
  beforeEach(() => {
    useWorkspace.setState({
      hostStatus: { state: 'ready', pid: 4242, launchKind: 'mock', error: null },
      logs: [
        '[2026-09-18 15:16:52] [WORKER] ready · PID 4242',
        '[2026-09-18 15:17:09] [TASK a1b2c3d4] progress · transcription.running · 1/2',
      ],
      model: {
        state: 'unloaded',
        modelId: null,
        device: null,
        computeType: null,
        deviceIndex: null,
        cpuThreads: null,
      },
    });
  });

  it('parses timestamp, source and content into stable log columns', () => {
    expect(parseWorkerLogLine('[2026-09-18 15:16:52] [WORKER] ready · PID 4242')).toEqual({
      date: '2026-09-18',
      message: 'ready · PID 4242',
      scope: 'WORKER',
      time: '15:16:52',
      tone: 'worker',
    });
    expect(parseWorkerLogLine('unstructured host message')).toEqual({
      date: null,
      message: 'unstructured host message',
      scope: 'SYSTEM',
      time: null,
      tone: 'worker',
    });
  });

  it('renders readable source badges without changing the raw export buffer', () => {
    render(<WorkerLogsView />);

    const log = screen.getByRole('log', { name: 'Worker 日志' });
    expect(within(log).getAllByText('2026-09-18')).toHaveLength(2);
    expect(within(log).getByText('15:16:52')).toBeInTheDocument();
    expect(within(log).getByText('WORKER')).toHaveAttribute('data-tone', 'worker');
    expect(within(log).getByText('TASK a1b2c3d4')).toHaveAttribute('data-tone', 'task');
    expect(within(log).getByText('ready · PID 4242')).toHaveClass('worker-log-message');
  });
});

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { desktopBridge } from '../bridge';
import { WorkerLogsView } from '../components/WorkerLogsView';
import { useWorkspace } from './workspace';
import { WORKER_LOG_LIMIT, WORKER_LOG_LINE_LIMIT } from './workerLogBuffer';

afterEach(() => vi.restoreAllMocks());

it('bounds 20,000 events, keeps latest/error, reuses row DOM and copies only retained lines', async () => {
  useWorkspace.setState(useWorkspace.getInitialState());
  const tasks = useWorkspace.getState().tasks;
  const copy = vi.spyOn(desktopBridge, 'copyWorkerLogs').mockResolvedValue();
  const exportLogs = vi.spyOn(desktopBridge, 'exportWorkerLogs').mockResolvedValue('logs.txt');
  const scroll = vi.fn();
  render(<WorkerLogsView />);
  Object.defineProperty(screen.getByRole('log'), 'scrollTo', { value: scroll });
  act(() => {
    for (let i = 0; i < 20000; i++)
      useWorkspace.getState().handleEvent({
        type: 'worker.log',
        line: i === 1 ? '[ERROR] critical failure' : `line-${i}`,
      });
  });
  expect(useWorkspace.getState().logs).toHaveLength(WORKER_LOG_LIMIT);
  expect(useWorkspace.getState().logsOffset).toBe(18500);
  expect(useWorkspace.getState().logs.at(-1)).toBe('line-19999');
  expect(useWorkspace.getState().tasks).toBe(tasks);
  expect(screen.getByText('[ERROR] critical failure')).toBeVisible();
  const log = screen.getByRole('log');
  expect(log.querySelectorAll('code')).toHaveLength(WORKER_LOG_LIMIT);
  const retained = log.querySelector('[data-log-index="18501"]');
  act(() => useWorkspace.getState().handleEvent({ type: 'worker.log', line: 'latest' }));
  expect(log.querySelector('[data-log-index="18501"]')).toBe(retained);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '复制缓冲区' }));
  expect(copy).toHaveBeenCalledWith(`${useWorkspace.getState().logs.join('\r\n')}\r\n`);
  expect(copy.mock.calls[0]![0]).not.toContain('line-0\r\n');
  await user.click(screen.getByRole('button', { name: '导出 TXT' }));
  expect(exportLogs).toHaveBeenCalledWith(copy.mock.calls[0]![0]);
  expect(screen.getByText(/已导出当前缓冲区 1500 行/)).toBeVisible();
  await user.click(within(screen.getByLabelText('Worker 日志状态')).getAllByRole('button')[3]!);
  expect(scroll).toHaveBeenCalled();
  expect(screen.getByText('已定位第 20001 行日志')).toBeVisible();
  act(() => useWorkspace.getState().handleEvent({ type: 'worker.logs_cleared' }));
  expect(useWorkspace.getState()).toMatchObject({
    logs: [],
    logsOffset: 0,
    latestErrorLog: null,
    clippedLogLines: 0,
  });
  expect(screen.queryByText('[ERROR] critical failure')).not.toBeInTheDocument();
});

it('bounds a single oversized event without affecting task state', () => {
  useWorkspace.setState(useWorkspace.getInitialState());
  useWorkspace
    .getState()
    .handleEvent({ type: 'worker.log', line: '[ERROR] ' + 'x'.repeat(100000) });
  expect(useWorkspace.getState().logs[0]!.length).toBeLessThanOrEqual(WORKER_LOG_LINE_LIMIT);
  expect(useWorkspace.getState().logs[0]).toContain('本行已截断');
  expect(useWorkspace.getState().clippedLogLines).toBe(1);
});

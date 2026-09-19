import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
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

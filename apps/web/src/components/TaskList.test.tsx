import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskSnapshot } from '../contracts/desktop';
import { useWorkspace } from '../state/workspace';
import { TaskList } from './TaskList';

const FINISHED_TASK: TaskSnapshot = {
  id: 'finished-history',
  title: '已完成访谈.wav',
  sourceCount: 1,
  presetId: 'cn2',
  modelId: 'large-v3-turbo',
  isCustom: false,
  status: 'completed',
  progress: 100,
  stage: '输出已生成',
  elapsed: '00:12',
  createdAt: '2026-07-22T20:00:00+08:00',
  outputs: ['D:\\Text\\已完成访谈.txt'],
  outputAvailability: 'available',
};

describe('TaskList destructive history controls', () => {
  beforeEach(() => {
    useWorkspace.setState({
      tasks: [structuredClone(FINISHED_TASK)],
      taskFilter: 'all',
      taskSearch: '',
      taskDateRange: null,
      outputAuditPending: false,
      selectedTaskId: null,
      outputPreview: null,
    });
  });

  it('requires two in-place activations and Escape cancels the armed state', async () => {
    const user = userEvent.setup();
    render(<TaskList expanded />);
    const remove = screen.getByRole('button', {
      name: '删除 已完成访谈.wav 的任务记录',
    });

    await user.click(remove);
    expect(remove).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('已完成访谈.wav')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /删除任务记录/ })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(remove).toHaveAttribute('aria-pressed', 'false');

    await user.click(remove);
    await user.click(
      screen.getByRole('button', { name: '再次点击删除 已完成访谈.wav 的任务记录' }),
    );
    expect(screen.queryByText('已完成访谈.wav')).not.toBeInTheDocument();
  });

  it('expires the inline confirmation after four seconds', () => {
    vi.useFakeTimers();
    try {
      render(<TaskList expanded />);
      const remove = screen.getByRole('button', {
        name: '删除 已完成访谈.wav 的任务记录',
      });

      fireEvent.click(remove);
      act(() => vi.advanceTimersByTime(4001));
      expect(remove).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('已完成访谈.wav')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the same two-stage interaction for bulk history clearing', async () => {
    const user = userEvent.setup();
    render(<TaskList expanded />);
    const clear = screen.getByRole('button', { name: /清除已完成历史/ });

    await user.click(clear);
    expect(clear).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('已完成访谈.wav')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /再次点击清除/ }));
    expect(screen.queryByText('已完成访谈.wav')).not.toBeInTheDocument();
  });
});

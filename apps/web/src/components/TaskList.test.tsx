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
    const clear = screen.getByRole('button', { name: /清除历史/ });

    await user.click(clear);
    expect(clear).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('已完成访谈.wav')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /再次点击清除/ }));
    expect(screen.queryByText('已完成访谈.wav')).not.toBeInTheDocument();
  });

  it('keeps status in the card header while the configuration summary stays status-free', () => {
    const { container } = render(<TaskList expanded />);

    expect(screen.queryByText('进度')).not.toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('转录模式')).toBeInTheDocument();
    expect(screen.getByText('中文防幻觉')).toBeInTheDocument();
    expect(container.querySelector('.task-card-format')).toHaveTextContent('TXT');
    expect(container.querySelector('.task-card-state')).toHaveTextContent('已完成');
    expect(container.querySelector('.task-card-status-group')).toContainElement(
      container.querySelector('.task-card-state'),
    );
    expect(container.querySelector('.task-card-status-group')).toContainElement(
      container.querySelector('.task-card-format-list'),
    );
    expect(container.querySelector('.task-history-facts')).not.toHaveTextContent('已完成');
    expect(container.querySelector('.task-history-progress-info')).toBeNull();
    expect(screen.queryByText('稳定主语言')).not.toBeInTheDocument();
    expect(container.querySelector('.progress-track')).toBeNull();
  });

  it('keeps output formats as independent header tags inside the archive region', () => {
    useWorkspace.setState({
      tasks: [
        {
          ...FINISHED_TASK,
          outputs: ['D:\\Text\\已完成访谈.txt', 'D:\\Markdown\\已完成访谈.md'],
        },
      ],
    });

    const { container } = render(<TaskList expanded />);

    expect(screen.getByRole('region', { name: '任务归档区' })).toContainElement(
      container.querySelector('.task-list'),
    );
    expect(screen.queryByText(/个任务 · 四列/)).not.toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll('.task-card-format'), (tag) => tag.textContent),
    ).toEqual(['TXT', 'MD']);
    expect(container.querySelector('.task-history-stat-line dd')).toHaveTextContent(
      '媒体1 个耗时00:12总时长未知',
    );
  });

  it('keeps a long task name available while marking its visual line for tail truncation', () => {
    const title = '当你拥有一棵赛博粒子交互的圣诞树并继续附加很长的任务说明.mkv';
    useWorkspace.setState({ tasks: [{ ...FINISHED_TASK, title }] });

    render(<TaskList expanded />);

    const taskTitle = screen.getByText(title);
    expect(taskTitle).toHaveAttribute('title', title);
    expect(taskTitle.closest('.task-title-line')).not.toBeNull();
  });

  it('shows only failed tasks in the attention filter', () => {
    useWorkspace.setState({
      tasks: [
        { ...FINISHED_TASK, id: 'failed', title: '失败任务.wav', status: 'failed' },
        { ...FINISHED_TASK, id: 'cancelled', title: '取消任务.wav', status: 'cancelled' },
        {
          ...FINISHED_TASK,
          id: 'missing-output',
          title: '输出缺失.wav',
          outputAvailability: 'missing',
        },
      ],
      taskFilter: 'failed',
    });

    render(<TaskList expanded />);

    expect(screen.getByText('失败任务.wav')).toBeInTheDocument();
    expect(screen.queryByText('取消任务.wav')).not.toBeInTheDocument();
    expect(screen.queryByText('输出缺失.wav')).not.toBeInTheDocument();
  });
});

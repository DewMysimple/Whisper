import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { TaskSnapshot, TaskMediaSnapshot } from '../../contracts/desktop';
import { TaskMediaList } from './TaskMediaList';
import { desktopBridge } from '../../bridge';
import { useWorkspace } from '../../state/workspace';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('locates the source and then generated text using the same keyboard-operable card', async () => {
  const reveal = vi.spyOn(desktopBridge, 'revealOutput').mockResolvedValue();
  const task = { ...useWorkspace.getInitialState().tasks[0]!, sourceCount: 1 };
  const media: TaskMediaSnapshot = {
    path: 'D:\\recording.wav',
    status: 'running',
    stage: '转录中',
    progress: 20,
    elapsedSeconds: 1,
  };
  const user = userEvent.setup();
  const { rerender } = render(
    <TaskMediaList
      task={task}
      mediaStates={[media]}
      currentMedia={undefined}
      mediaSeconds={1}
      isInputTaskPreview={false}
    />,
  );
  const source = screen.getByRole('button', { name: '在资源管理器中定位 recording.wav' });
  source.focus();
  await user.keyboard('{Enter}');
  expect(reveal).toHaveBeenLastCalledWith(media.path);
  const done = { ...media, status: 'completed' as const, outputPaths: ['E:\\renamed.md'] };
  rerender(
    <TaskMediaList
      task={task}
      mediaStates={[done]}
      currentMedia={undefined}
      mediaSeconds={1}
      isInputTaskPreview={false}
    />,
  );
  await user.click(screen.getByRole('button', { name: '在资源管理器中定位 renamed.md' }));
  expect(reveal).toHaveBeenLastCalledWith('E:\\renamed.md');
  reveal.mockRejectedValueOnce(new Error('文件不存在'));
  await user.click(screen.getByRole('button', { name: '在资源管理器中定位 renamed.md' }));
  expect(useWorkspace.getState().lastError).toBe('文件不存在');
});

it('follows media inside its scroll container and respects manual browsing', () => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 1),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  const task: TaskSnapshot = {
    id: 'one',
    title: 'batch',
    sourceCount: 2,
    presetId: 'cn',
    modelId: 'large-v3-turbo',
    isCustom: false,
    status: 'running',
    progress: 40,
    stage: '转录中',
    elapsed: '00:03',
    createdAt: '2026-09-19T00:00:00Z',
  };
  const media: TaskMediaSnapshot[] = [0, 1].map((i) => ({
    path: `D:\\${i}.wav`,
    status: 'running',
    progress: 10,
    stage: '转录中',
    elapsedSeconds: 3,
  }));
  const { container, rerender } = render(
    <TaskMediaList
      task={task}
      mediaStates={media}
      currentMedia={media[0]}
      mediaSeconds={3}
      isInputTaskPreview={false}
    />,
  );
  const list = container.querySelector<HTMLDivElement>('.task-media-list')!;
  const rows = container.querySelectorAll<HTMLElement>('.task-media-row');
  const scroll = vi.fn();
  list.scrollTo = scroll;
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({
    top: 100,
    bottom: 300,
    height: 200,
  } as DOMRect);
  Object.defineProperty(list, 'clientHeight', { value: 200 });
  for (const row of rows)
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      top: 500,
      bottom: 550,
      height: 50,
    } as DOMRect);
  act(() => vi.advanceTimersByTime(2));
  expect(scroll).toHaveBeenCalledWith({ top: 325, behavior: expect.any(String) });
  scroll.mockClear();
  fireEvent.wheel(list);
  rerender(
    <TaskMediaList
      task={task}
      mediaStates={media}
      currentMedia={media[1]}
      mediaSeconds={4}
      isInputTaskPreview={false}
    />,
  );
  act(() => vi.advanceTimersByTime(2));
  expect(scroll).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(8000));
  expect(scroll).toHaveBeenCalledTimes(1);
});

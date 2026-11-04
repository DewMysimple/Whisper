import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { desktopBridge } from '../bridge';
import { QualityReviewActions } from './QualityReviewActions';
import { diagnosticRange } from '../state/diagnosticTime';

afterEach(() => vi.restoreAllMocks());

it('copies exact text and millisecond timecodes, locates the associated media, and reports failures', async () => {
  const copy = vi.spyOn(desktopBridge, 'copyWorkerLogs').mockResolvedValue();
  const reveal = vi.spyOn(desktopBridge, 'revealOutput').mockResolvedValue();
  render(
    <QualityReviewActions
      mediaPath={'D:\\source.wav'}
      text=" 原话 "
      start={3600.125}
      end={3602.999}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '复制片段' }));
  expect(copy).toHaveBeenLastCalledWith(' 原话 ');
  expect(screen.getByRole('status')).toHaveTextContent('已复制片段文本');
  await user.click(screen.getByRole('button', { name: '复制时间' }));
  expect(copy).toHaveBeenLastCalledWith('01:00:00,125 --> 01:00:02,999');
  await user.click(screen.getByRole('button', { name: '定位媒体' }));
  expect(reveal).toHaveBeenCalledWith('D:\\source.wav');
  expect(screen.getByRole('status')).toHaveTextContent('已定位源媒体');
  copy.mockRejectedValue(new Error('denied'));
  await user.click(screen.getByRole('button', { name: '复制片段' }));
  expect(screen.getByRole('status')).toHaveTextContent('复制失败');
  reveal.mockRejectedValue(new Error('missing'));
  await user.click(screen.getByRole('button', { name: '定位媒体' }));
  expect(screen.getByRole('status')).toHaveTextContent('定位失败');
});

it.each([
  [null, 1],
  [0, null],
  [NaN, 1],
  [0, Infinity],
  [-1, 2],
  [2, 1],
  [1, 1],
  [0, Number.MAX_VALUE],
])('protects invalid range %s..%s', (start, end) => {
  expect(diagnosticRange(start!, end!)).toBeNull();
  render(<QualityReviewActions mediaPath="" text="" start={start!} end={end!} />);
  for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
});

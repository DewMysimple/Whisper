import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  notifyTaskFinished: vi.fn(),
  notifyPowerCountdown: vi.fn(),
}));

vi.mock('./bridge', () => ({ desktopBridge: bridge }));

import { notifyPowerCountdown, notifyTaskFinished } from './notifications';

describe('notification facade', () => {
  beforeEach(() => {
    bridge.notifyTaskFinished.mockReset().mockResolvedValue(true);
    bridge.notifyPowerCountdown.mockReset().mockResolvedValue(true);
  });

  it('routes task completion through the typed desktop bridge', async () => {
    const notice = {
      status: 'completed' as const,
      elapsed: '03:18',
      detail: '已生成 2 个输出文件',
    };

    await expect(notifyTaskFinished(notice)).resolves.toBe(true);
    expect(bridge.notifyTaskFinished).toHaveBeenCalledWith(notice);
  });

  it('routes the power countdown through the typed desktop bridge', async () => {
    await expect(notifyPowerCountdown('04:27')).resolves.toBe(true);
    expect(bridge.notifyPowerCountdown).toHaveBeenCalledWith('04:27');
  });
});

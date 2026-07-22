import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  requestUserAttention: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ requestUserAttention: native.requestUserAttention }),
  UserAttentionType: { Critical: 1, Informational: 2 },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('./bridge/tauriDesktopBridge', () => ({ isTauriRuntime: () => true }));

import { notifyTaskFinished } from './notifications';

describe('task completion notification', () => {
  beforeEach(() => {
    native.requestUserAttention.mockReset().mockResolvedValue(undefined);
    native.invoke.mockReset().mockResolvedValue(undefined);
  });

  it('requests attention and sends an audible completion notice', async () => {
    await expect(
      notifyTaskFinished({
        status: 'completed',
        title: '访谈 01.mp4',
        detail: '已生成 2 个输出文件',
      }),
    ).resolves.toBe(true);

    expect(native.requestUserAttention).toHaveBeenCalledWith(2);
    expect(native.invoke).toHaveBeenCalledWith('show_app_notification', {
      status: 'completed',
      title: '访谈 01.mp4',
      detail: '已生成 2 个输出文件',
    });
  });

  it('isolates a native notification failure from task finalization', async () => {
    native.invoke.mockRejectedValue(new Error('toast unavailable'));

    await expect(
      notifyTaskFinished({ status: 'failed', title: '访谈 01.mp4', detail: '模型错误' }),
    ).resolves.toBe(false);

    expect(native.requestUserAttention).toHaveBeenCalledWith(1);
    expect(native.invoke).toHaveBeenCalledWith('show_app_notification', {
      status: 'failed',
      title: '访谈 01.mp4',
      detail: '模型错误',
    });
  });
});

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

import { notifyPowerCountdown, notifyTaskFinished } from './notifications';

describe('task completion notification', () => {
  beforeEach(() => {
    native.requestUserAttention.mockReset().mockResolvedValue(undefined);
    native.invoke.mockReset().mockResolvedValue(undefined);
  });

  it('requests attention and sends an audible completion notice', async () => {
    await expect(
      notifyTaskFinished({
        status: 'completed',
        elapsed: '03:18',
        detail: '已生成 2 个输出文件',
      }),
    ).resolves.toBe(true);

    expect(native.requestUserAttention).toHaveBeenCalledWith(2);
    expect(native.invoke).toHaveBeenCalledWith('show_app_notification', {
      status: 'completed',
      title: '总耗时 03:18',
      detail: '已生成 2 个输出文件',
    });
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });

  it('isolates a native notification failure from task finalization', async () => {
    native.invoke.mockRejectedValue(new Error('toast unavailable'));

    await expect(
      notifyTaskFinished({ status: 'failed', elapsed: '00:12', detail: '模型错误' }),
    ).resolves.toBe(false);

    expect(native.requestUserAttention).toHaveBeenCalledWith(1);
    expect(native.invoke).toHaveBeenCalledWith('show_app_notification', {
      status: 'failed',
      title: '总耗时 00:12',
      detail: '模型错误',
    });
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });

  it('uses the branded app notification and one sound for a power countdown', async () => {
    await expect(notifyPowerCountdown('04:27')).resolves.toBe(true);

    expect(native.requestUserAttention).toHaveBeenCalledWith(1);
    expect(native.invoke).toHaveBeenCalledWith('show_app_notification', {
      status: 'power',
      title: '总耗时 04:27 · 60 秒后关机',
      detail: '点击通知返回 WhisperSubtitle，可取消本次关机。',
    });
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });
});

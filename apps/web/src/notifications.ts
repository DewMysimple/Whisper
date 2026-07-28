import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';

import { isTauriRuntime } from './bridge/tauriDesktopBridge';

export interface TaskFinishedNotice {
  status: 'completed' | 'failed' | 'cancelled';
  elapsed: string;
  detail: string;
}

export async function notifyTaskFinished(notice: TaskFinishedNotice): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  const attentionType =
    notice.status === 'failed' ? UserAttentionType.Critical : UserAttentionType.Informational;

  try {
    await getCurrentWindow().requestUserAttention(attentionType);
  } catch {
    // A denied attention permission must not disturb task finalization.
  }

  try {
    await invoke('show_app_notification', {
      status: notice.status,
      title: `总耗时 ${notice.elapsed}`,
      detail: notice.detail,
    });
  } catch {
    return false;
  }
  return true;
}

export async function notifyPowerCountdown(elapsed: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    await getCurrentWindow().requestUserAttention(UserAttentionType.Critical);
  } catch {
    // The visible in-app countdown remains available when attention is denied.
  }
  try {
    await invoke('show_app_notification', {
      status: 'power',
      title: `总耗时 ${elapsed} · 60 秒后关机`,
      detail: '点击通知返回 WhisperSubtitle，可取消本次关机。',
    });
    return true;
  } catch {
    return false;
  }
}

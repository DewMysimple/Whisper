import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';

import { isTauriRuntime } from './bridge/tauriDesktopBridge';

export interface TaskFinishedNotice {
  status: 'completed' | 'failed' | 'cancelled';
  title: string;
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
      title: notice.title,
      detail: notice.detail,
    });
    return true;
  } catch {
    return false;
  }
}

import { desktopBridge } from './bridge';
import type { TaskFinishedNotice } from './contracts/desktop';

export type { TaskFinishedNotice } from './contracts/desktop';

export async function notifyTaskFinished(notice: TaskFinishedNotice): Promise<boolean> {
  return desktopBridge.notifyTaskFinished(notice);
}

export async function notifyPowerCountdown(elapsed: string): Promise<boolean> {
  return desktopBridge.notifyPowerCountdown(elapsed);
}

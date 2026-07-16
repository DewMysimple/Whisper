import type { DesktopBridge } from '../contracts/desktop';
import { MockDesktopBridge } from './mockDesktopBridge';
import { TauriDesktopBridge, isTauriRuntime } from './tauriDesktopBridge';

export const desktopBridge: DesktopBridge = isTauriRuntime()
  ? new TauriDesktopBridge()
  : new MockDesktopBridge();

export type { DesktopBridge } from '../contracts/desktop';

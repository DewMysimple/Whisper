import { afterEach, expect, it, vi } from 'vitest';
import type { DesktopEvent, HostStatus } from '../contracts/desktop';

const native = vi.hoisted(() => ({
  listener: undefined as ((event: DesktopEvent) => void) | undefined,
  status: vi.fn(),
}));
vi.mock('../bridge', () => ({
  desktopBridge: {
    mode: 'tauri',
    subscribe: (listener: (event: DesktopEvent) => void) => {
      native.listener = listener;
      return () => {
        native.listener = undefined;
      };
    },
    getHostStatus: native.status,
    getPowerCapabilities: async () => ({ shutdown: true }),
    getPowerActionStatus: async () => ({
      state: 'idle',
      action: null,
      executeAtEpochMs: null,
      error: null,
    }),
  },
}));
vi.mock('../notifications', () => ({ notifyTaskFinished: vi.fn(), notifyPowerCountdown: vi.fn() }));

import { useWorkspace } from './workspace';
import { flushPersistence, persistLater, preferencesFromState } from './workspacePersistence';
import { saveWorkspaceState } from './persistence';

afterEach(() => {
  flushPersistence();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

it('preserves a live task across effect remounts and ignores a stale initial status', async () => {
  let resolveStatus!: (status: HostStatus) => void;
  native.status.mockImplementation(
    () =>
      new Promise<HostStatus>((resolve) => {
        resolveStatus = resolve;
      }),
  );
  saveWorkspaceState(preferencesFromState(useWorkspace.getState()), []);
  const cleanup = useWorkspace.getState().initialize();
  native.listener?.({
    type: 'host.status',
    status: { state: 'ready', pid: 12, launchKind: 'development-python', error: null },
  });
  native.listener?.({
    type: 'task.queued',
    task: {
      id: 'live',
      title: 'live.wav',
      status: 'queued',
      progress: 0,
      stage: '等待',
      elapsed: '00:00',
      sourceCount: 1,
      presetId: 'cn',
      modelId: 'large-v3-turbo',
      isCustom: false,
      createdAt: new Date().toISOString(),
    },
  });
  resolveStatus({ state: 'starting', pid: null, launchKind: null, error: null });
  await Promise.resolve();
  expect(useWorkspace.getState().hostStatus.state).toBe('ready');
  cleanup();
  const cleanupAgain = useWorkspace.getState().initialize();
  expect(useWorkspace.getState().tasks[0]?.status).toBe('queued');
  cleanupAgain();
});

it('checkpoints continuous events and flushes pending history without leaking storage failures', () => {
  vi.useFakeTimers();
  const write = vi.spyOn(Storage.prototype, 'setItem');
  for (let i = 0; i < 10; i++) {
    persistLater(useWorkspace.getState);
    vi.advanceTimersByTime(50);
  }
  expect(write.mock.calls.length).toBeGreaterThanOrEqual(3);
  persistLater(useWorkspace.getState);
  flushPersistence();
  expect(vi.getTimerCount()).toBe(0);
  write.mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError');
  });
  persistLater(useWorkspace.getState);
  expect(() => flushPersistence()).not.toThrow();
  expect(useWorkspace.getState().lastError).toContain('保存失败');
});

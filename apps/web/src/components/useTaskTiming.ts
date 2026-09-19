import { useEffect, useRef, useState } from 'react';

import type { TaskMediaSnapshot, TaskSnapshot } from '../contracts/desktop';
import { elapsedTextSeconds } from '../state/taskTiming';

export { formatElapsedSeconds } from '../state/taskTiming';

interface ClockAnchor {
  key: string;
  base: number;
  value: number;
  observedAt: number;
  running: boolean;
}

function readClock(
  anchor: ClockAnchor,
  key: string,
  base: number,
  running: boolean,
  now: number,
): number {
  if (anchor.key !== key || anchor.base !== base) {
    Object.assign(anchor, { key, base, value: base, observedAt: now, running });
  } else if (anchor.running !== running) {
    if (anchor.running) anchor.value += Math.max(0, (now - anchor.observedAt) / 1000);
    anchor.observedAt = now;
    anchor.running = running;
  }
  return anchor.value + (running ? Math.max(0, (now - anchor.observedAt) / 1000) : 0);
}

export function useTaskTiming(
  task: TaskSnapshot | undefined,
  currentMedia: TaskMediaSnapshot | undefined,
): { taskSeconds: number; mediaSeconds: number } {
  const [, tick] = useState(0);
  const now = Date.now();
  const taskBase = task?.taskElapsedSeconds ?? elapsedTextSeconds(task?.elapsed ?? '00:00');
  const mediaBase = currentMedia?.elapsedSeconds ?? 0;
  const taskRunning = task?.status === 'running';
  const mediaRunning = taskRunning && currentMedia?.status === 'running';
  const taskClock = useRef<ClockAnchor>({
    key: '',
    base: 0,
    value: 0,
    observedAt: now,
    running: false,
  });
  const mediaClock = useRef<ClockAnchor>({
    key: '',
    base: 0,
    value: 0,
    observedAt: now,
    running: false,
  });

  useEffect(() => {
    if (!taskRunning) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [taskRunning]);

  return {
    taskSeconds: readClock(taskClock.current, task?.id ?? '', taskBase, taskRunning, now),
    mediaSeconds: readClock(
      mediaClock.current,
      `${task?.id ?? ''}:${currentMedia?.path ?? ''}`,
      mediaBase,
      mediaRunning,
      now,
    ),
  };
}

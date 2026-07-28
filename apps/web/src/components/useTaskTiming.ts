import { useEffect, useRef, useState } from 'react';

import type { TaskMediaSnapshot, TaskSnapshot } from '../contracts/desktop';

interface TimingAnchor {
  taskId: string;
  taskSnapshotBase: number;
  taskValue: number;
  mediaPath: string | null;
  mediaSnapshotBase: number;
  mediaValue: number;
  observedAt: number;
  taskWasRunning: boolean;
  mediaWasRunning: boolean;
}

function elapsedTextSeconds(value: string): number {
  const parts = value
    .split(':')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  return 0;
}

export function formatElapsedSeconds(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainder
        .toString()
        .padStart(2, '0')}`
    : `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
}

export function useTaskTiming(
  task: TaskSnapshot | undefined,
  currentMedia: TaskMediaSnapshot | undefined,
): { taskSeconds: number; mediaSeconds: number } {
  const [now, setNow] = useState(() => Date.now());
  const taskBase = task?.taskElapsedSeconds ?? elapsedTextSeconds(task?.elapsed ?? '00:00');
  const mediaBase = currentMedia?.elapsedSeconds ?? 0;
  const mediaPath = currentMedia?.path ?? null;
  const taskRunning = task?.status === 'running';
  const mediaRunning = taskRunning && currentMedia?.status === 'running';
  const anchor = useRef<TimingAnchor>({
    taskId: task?.id ?? '',
    taskSnapshotBase: taskBase,
    taskValue: taskBase,
    mediaPath,
    mediaSnapshotBase: mediaBase,
    mediaValue: mediaBase,
    observedAt: now,
    taskWasRunning: taskRunning,
    mediaWasRunning: mediaRunning,
  });

  const observedAt = Date.now();
  if (
    anchor.current.taskId !== (task?.id ?? '') ||
    anchor.current.taskSnapshotBase !== taskBase ||
    anchor.current.mediaPath !== mediaPath ||
    anchor.current.mediaSnapshotBase !== mediaBase
  ) {
    anchor.current = {
      taskId: task?.id ?? '',
      taskSnapshotBase: taskBase,
      taskValue: taskBase,
      mediaPath,
      mediaSnapshotBase: mediaBase,
      mediaValue: mediaBase,
      observedAt,
      taskWasRunning: taskRunning,
      mediaWasRunning: mediaRunning,
    };
  } else if (anchor.current.taskWasRunning && !taskRunning) {
    const delta = Math.max(0, (observedAt - anchor.current.observedAt) / 1000);
    anchor.current.taskValue += delta;
    if (anchor.current.mediaWasRunning) anchor.current.mediaValue += delta;
    anchor.current.observedAt = observedAt;
  }
  anchor.current.taskWasRunning = taskRunning;
  anchor.current.mediaWasRunning = mediaRunning;

  useEffect(() => {
    if (!taskRunning && !mediaRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [mediaRunning, taskRunning]);

  const delta = Math.max(0, (now - anchor.current.observedAt) / 1000);
  return {
    taskSeconds: anchor.current.taskValue + (taskRunning ? delta : 0),
    mediaSeconds: anchor.current.mediaValue + (mediaRunning ? delta : 0),
  };
}

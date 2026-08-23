import type { DesktopEvent, TaskSnapshot, TaskStatus } from '../contracts/desktop';

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function activeTaskId(tasks: TaskSnapshot[]): string | null {
  return (
    tasks.find((task) => task.status === 'running')?.id ??
    [...tasks].reverse().find((task) => task.status === 'queued')?.id ??
    null
  );
}

export function taskOutputPaths(task: TaskSnapshot | undefined): string[] {
  if (task === undefined) return [];
  return [
    ...new Set([
      ...(task.outputs ?? []),
      ...(task.mediaStates ?? []).flatMap((media) => media.outputPaths ?? []),
    ]),
  ];
}

export function canResumeTask(task: TaskSnapshot): boolean {
  if (task.status !== 'failed' && task.status !== 'cancelled') return false;
  const mediaStates = task.mediaStates ?? [];
  const hasReliableCompletion = mediaStates.some(
    (media) =>
      (media.status === 'completed' || media.status === 'skipped') &&
      (media.outputPaths?.length ?? 0) > 0,
  );
  const hasUnfinishedMedia = mediaStates.some(
    (media) =>
      media.status === 'pending' || media.status === 'running' || media.status === 'failed',
  );
  return task.draft !== undefined && hasReliableCompletion && hasUnfinishedMedia;
}

export function isAbnormalTask(task: TaskSnapshot): boolean {
  return (
    task.status === 'failed' ||
    task.status === 'cancelled' ||
    (task.status === 'completed' && task.outputAvailability === 'missing')
  );
}

export function updateTaskMediaStates(
  task: TaskSnapshot,
  event: Extract<DesktopEvent, { type: 'task.progress' }>,
): TaskSnapshot['mediaStates'] {
  const path = event.inputPath;
  if (path === undefined) return task.mediaStates;
  const current: NonNullable<TaskSnapshot['mediaStates']> =
    task.mediaStates ??
    (task.mediaPaths ?? []).map((mediaPath) => ({
      path: mediaPath,
      status: 'pending' as const,
      progress: 0,
      stage: '等待处理',
      elapsedSeconds: 0,
    }));
  const normalizedPath = path.toLocaleLowerCase();
  return current.map((media) => {
    if (media.path.toLocaleLowerCase() === normalizedPath) {
      return {
        ...media,
        status: event.mediaStatus ?? 'running',
        progress: event.mediaProgress ?? media.progress,
        stage: event.stage,
        elapsedSeconds: event.mediaElapsedSeconds ?? media.elapsedSeconds,
        outputPaths:
          event.outputPaths !== undefined && event.outputPaths.length > 0
            ? event.outputPaths
            : media.outputPaths,
        qualityDiagnostics: event.qualityDiagnostics ?? media.qualityDiagnostics,
      };
    }
    if (
      event.mediaIndex !== undefined &&
      media.status === 'pending' &&
      (task.mediaPaths ?? []).findIndex(
        (candidate) => candidate.toLocaleLowerCase() === media.path.toLocaleLowerCase(),
      ) <
        event.mediaIndex - 1
    ) {
      return { ...media, status: 'completed', progress: 100, stage: '已完成' };
    }
    return media;
  });
}

export function limitTaskQualityDiagnostics(
  mediaStates: TaskSnapshot['mediaStates'],
): TaskSnapshot['mediaStates'] {
  if (mediaStates === undefined) return undefined;
  let remainingTaskSegments = 50;
  let remainingTaskRegions = 50;
  let remainingTaskDetailCandidates = 50;
  return mediaStates.map((media) => {
    const diagnostics = media.qualityDiagnostics;
    if (diagnostics === undefined) return media;
    const retainedCount = Math.min(12, remainingTaskSegments, diagnostics.segments.length);
    const retainedRegionCount = Math.min(
      12,
      remainingTaskRegions,
      diagnostics.languageRegions?.length ?? 0,
    );
    const retainedCandidateCount = Math.min(
      12,
      remainingTaskDetailCandidates,
      diagnostics.detailCandidates?.length ?? 0,
    );
    remainingTaskSegments -= retainedCount;
    remainingTaskRegions -= retainedRegionCount;
    remainingTaskDetailCandidates -= retainedCandidateCount;
    return {
      ...media,
      qualityDiagnostics: {
        ...diagnostics,
        segments: diagnostics.segments.slice(0, retainedCount),
        languageRegions: diagnostics.languageRegions?.slice(0, retainedRegionCount),
        detailCandidates: diagnostics.detailCandidates?.slice(0, retainedCandidateCount),
        omittedSegmentCount: Math.max(0, diagnostics.lowConfidenceCount - retainedCount),
      },
    };
  });
}

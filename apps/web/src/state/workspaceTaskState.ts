import type {
  DesktopEvent,
  TaskSnapshot,
  TaskStatus,
  TaskMediaSnapshot,
  OutputPathStatus,
} from '../contracts/desktop';

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
      // Skipped paths identify the conflict for continuation checks; the task
      // did not generate them, and an active owner's file may not exist yet.
      ...(task.mediaStates ?? []).flatMap((media) =>
        media.status === 'skipped' ? [] : (media.outputPaths ?? []),
      ),
    ]),
  ];
}

export function canResumeTask(task: TaskSnapshot): boolean {
  if (!isTerminalTaskStatus(task.status)) return false;
  const mediaStates = task.mediaStates ?? [];
  if (
    task.mediaPaths?.some(
      (path) => !mediaStates.some((m) => m.path.toLowerCase() === path.toLowerCase()),
    )
  )
    return false;
  return (
    task.draft !== undefined &&
    mediaStates.some((m) => m.status !== 'skipped') &&
    (task.status !== 'completed' || task.outputAvailability === 'missing')
  );
}

export function auditMediaOutputs(
  task: TaskSnapshot,
  media: TaskMediaSnapshot,
  statuses: Map<string, OutputPathStatus>,
): 'available' | 'missing' | 'unconfirmed' {
  const outputs = media.outputPaths ?? [];
  if (!task.draft || outputs.length === 0) return 'unconfirmed';
  const policy = task.draft.output;
  const required = [
    policy.txtEnabled ? '.txt' : null,
    policy.markdownEnabled ? '.md' : null,
    policy.srtEnabled ? '.srt' : null,
  ].filter((x) => x !== null);
  if (required.some((ext) => !outputs.some((path) => path.toLowerCase().endsWith(ext))))
    return 'missing';
  if (outputs.some((path) => !statuses.has(path.toLowerCase()))) return 'unconfirmed';
  return outputs.every((path) => {
    const status = statuses.get(path.toLowerCase());
    return status?.exists && status.valid === true;
  })
    ? 'available'
    : 'missing';
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
  const mediaStates = current.some((media) => media.path.toLocaleLowerCase() === normalizedPath)
    ? current
    : [
        ...current,
        { path, status: 'pending' as const, progress: 0, stage: '等待处理', elapsedSeconds: 0 },
      ];
  return mediaStates.map((media) => {
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

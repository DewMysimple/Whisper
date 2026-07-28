export interface TaskProgressSample {
  stage: string;
  current: number;
  total: number;
  mediaProgress?: number;
  mediaStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
}

interface TaskProgressState {
  progress: number;
  mediaIndex: number;
  mediaProgress: number;
  total: number;
}

const PREPARATION_PROGRESS: Record<string, number> = {
  'input.validating': 2,
  'input.discovering': 6,
  'model.loading': 10,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function mediaPhaseProgress(
  stage: string,
  mediaProgress: number,
  mediaStatus: TaskProgressSample['mediaStatus'],
): number | null {
  if (mediaStatus === 'failed' || mediaStatus === 'skipped') return 1;
  if (stage === 'transcription.running') return 0.85 * (mediaProgress / 100);
  if (stage === 'postprocess.running') return 0.9;
  if (stage === 'output.writing') {
    return mediaStatus === 'completed' || mediaProgress >= 100 ? 1 : 0.97;
  }
  return null;
}

export class TaskProgressTracker {
  private readonly tasks = new Map<string, TaskProgressState>();

  start(taskId: string, total = 0): void {
    this.tasks.set(taskId, {
      progress: 0,
      mediaIndex: 0,
      mediaProgress: 0,
      total: Math.max(0, total),
    });
  }

  update(taskId: string, sample: TaskProgressSample): number {
    const previous = this.tasks.get(taskId) ?? {
      progress: 0,
      mediaIndex: 0,
      mediaProgress: 0,
      total: 0,
    };
    const total = sample.total > 0 ? sample.total : previous.total;
    let candidate = PREPARATION_PROGRESS[sample.stage] ?? previous.progress;
    let mediaIndex = previous.mediaIndex;
    let mediaProgress = previous.mediaProgress;

    if (sample.stage === 'task.finalizing') {
      candidate = 99;
    } else if (total > 0 && sample.current > 0) {
      const current = clamp(Math.trunc(sample.current), 1, total);
      if (current !== mediaIndex) {
        mediaIndex = current;
        mediaProgress = 0;
      }
      if (sample.mediaProgress !== undefined) {
        mediaProgress = Math.max(mediaProgress, clamp(sample.mediaProgress, 0, 100));
      }
      const phase = mediaPhaseProgress(sample.stage, mediaProgress, sample.mediaStatus);
      if (phase !== null) {
        const completedMedia = current - 1;
        candidate = 10 + 87 * ((completedMedia + phase) / total);
      }
    }

    const progress = Math.round(clamp(Math.max(previous.progress, candidate), 0, 99));
    this.tasks.set(taskId, { progress, mediaIndex, mediaProgress, total });
    return progress;
  }

  finish(taskId: string): void {
    this.tasks.delete(taskId);
  }

  clear(): void {
    this.tasks.clear();
  }
}

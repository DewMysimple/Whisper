import type { InputSource, TaskMediaSnapshot, TaskSnapshot } from '../contracts/desktop';

export interface MediaDurationSummary {
  knownSeconds: number;
  unknownCount: number;
}

export function formatMediaDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '时长未知';
  }
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  const clock = [minutes, remainingSeconds].map((value) => String(value).padStart(2, '0'));
  if (hours > 0) clock.unshift(String(hours).padStart(2, '0'));
  return clock.join(':');
}

export function summarizeInputDurations(inputs: InputSource[]): MediaDurationSummary {
  return inputs.reduce<MediaDurationSummary>(
    (summary, input) => ({
      knownSeconds: summary.knownSeconds + (input.durationSeconds ?? 0),
      unknownCount:
        summary.unknownCount +
        (input.unknownDurationCount ??
          (input.durationSeconds === undefined ? (input.mediaCount ?? 1) : 0)),
    }),
    { knownSeconds: 0, unknownCount: 0 },
  );
}

export function summarizeMediaDurations(media: TaskMediaSnapshot[]): MediaDurationSummary {
  return media.reduce<MediaDurationSummary>(
    (summary, item) => ({
      knownSeconds: summary.knownSeconds + (item.durationSeconds ?? 0),
      unknownCount: summary.unknownCount + (item.durationSeconds == null ? 1 : 0),
    }),
    { knownSeconds: 0, unknownCount: 0 },
  );
}

export function formatDurationSummary(summary: MediaDurationSummary): string {
  if (summary.unknownCount > 0) {
    return summary.knownSeconds > 0
      ? `已知 ${formatMediaDuration(summary.knownSeconds)} + ${summary.unknownCount} 个未知`
      : `${summary.unknownCount} 个时长未知`;
  }
  return `总时长 ${formatMediaDuration(summary.knownSeconds)}`;
}

export function taskDurationSummary(task: TaskSnapshot): MediaDurationSummary {
  if (
    task.totalMediaDurationSeconds !== undefined ||
    task.unknownMediaDurationCount !== undefined
  ) {
    return {
      knownSeconds: task.totalMediaDurationSeconds ?? 0,
      unknownCount: task.unknownMediaDurationCount ?? 0,
    };
  }
  if (task.mediaStates && task.mediaStates.length > 0) {
    return summarizeMediaDurations(task.mediaStates);
  }
  if (task.draft) {
    return summarizeInputDurations(task.draft.inputs);
  }
  return { knownSeconds: 0, unknownCount: task.sourceCount };
}

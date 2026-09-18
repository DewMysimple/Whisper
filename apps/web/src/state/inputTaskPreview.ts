import type {
  InputSource,
  ModelId,
  PresetId,
  TaskMediaSnapshot,
  TaskSnapshot,
} from '../contracts/desktop';

export const INPUT_TASK_PREVIEW_ID = 'input-task-preview';

function directoryPreviewPaths(source: InputSource): string[] {
  const count = Math.max(1, source.mediaCount ?? 1);
  const folderName = source.path.split(/[/\\]/).at(-1) || '媒体';
  return Array.from(
    { length: count },
    (_, index) => `${source.path}\\${folderName}-${String(index + 1).padStart(2, '0')}.mp4`,
  );
}

function previewMedia(source: InputSource): TaskMediaSnapshot[] {
  const paths = source.kind === 'directory' ? directoryPreviewPaths(source) : [source.path];
  const duration =
    source.durationSeconds === undefined ? undefined : source.durationSeconds / paths.length;
  return paths.map((path) => ({
    path,
    status: 'pending',
    progress: 0,
    stage: '等待开始',
    elapsedSeconds: 0,
    durationSeconds: duration,
  }));
}

export function createInputTaskPreview(
  inputs: InputSource[],
  presetId: PresetId,
  modelId: ModelId,
): TaskSnapshot | null {
  if (inputs.length === 0) return null;

  const mediaStates = inputs.flatMap(previewMedia);
  const title =
    mediaStates.length === 1
      ? (mediaStates[0]?.path.split(/[/\\]/).at(-1) ?? '待处理媒体')
      : `${mediaStates.length} 个待处理媒体`;

  return {
    id: INPUT_TASK_PREVIEW_ID,
    title,
    sourceCount: mediaStates.length,
    presetId,
    modelId,
    isCustom: false,
    status: 'queued',
    progress: 0,
    stage: '等待开始',
    elapsed: '00:00',
    createdAt: new Date().toISOString(),
    mediaPaths: mediaStates.map((media) => media.path),
    processingCount: mediaStates.length,
    currentMediaIndex: 0,
    taskElapsedSeconds: 0,
    totalMediaDurationSeconds: mediaStates.reduce(
      (total, media) => total + (media.durationSeconds ?? 0),
      0,
    ),
    unknownMediaDurationCount: mediaStates.filter((media) => media.durationSeconds === undefined)
      .length,
    mediaStates,
  };
}

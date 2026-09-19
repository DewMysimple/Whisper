import type { InputSource, ModelId, PresetId, TaskSnapshot } from '../contracts/desktop';
import { summarizeInputDurations } from './mediaDuration';

export const INPUT_TASK_PREVIEW_ID = 'input-task-preview';

export function createInputTaskPreview(
  inputs: InputSource[],
  presetId: PresetId,
  modelId: ModelId,
): TaskSnapshot | null {
  if (inputs.length === 0) return null;

  // inspect_inputs supplies directory summaries, not child paths or individual durations.
  const sourceCount = inputs.reduce(
    (total, input) => total + (input.mediaCount ?? (input.kind === 'file' ? 1 : 0)),
    0,
  );
  const durations = summarizeInputDurations(inputs);
  return {
    id: INPUT_TASK_PREVIEW_ID,
    title:
      inputs.length === 1
        ? (inputs[0]!.path.split(/[/\\]/).at(-1) ?? '待处理输入')
        : `${sourceCount} 个待处理媒体`,
    sourceCount,
    presetId,
    modelId,
    isCustom: false,
    status: 'queued',
    progress: 0,
    stage: '等待开始',
    elapsed: '00:00',
    createdAt: new Date().toISOString(),
    processingCount: sourceCount,
    currentMediaIndex: 0,
    taskElapsedSeconds: 0,
    totalMediaDurationSeconds: durations.knownSeconds,
    unknownMediaDurationCount: durations.unknownCount,
    mediaStates: inputs.map((input) => ({
      path: input.path,
      status: 'pending',
      progress: 0,
      stage: !input.valid
        ? '输入无效'
        : input.kind === 'directory'
          ? `文件夹 · ${input.mediaCount ?? '未知数量'} 个媒体，提交后展开`
          : '等待开始',
      elapsedSeconds: 0,
      durationSeconds: input.durationSeconds,
    })),
  };
}

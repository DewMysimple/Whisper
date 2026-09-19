import type { TaskSnapshot } from '../../contracts/desktop';
import { getModelLabel } from '../../data/models';
import { getPreset, transcriptionTaskLabel } from '../../data/presets';
import { useWorkspace } from '../../state/workspace';
import { ConfirmDialog } from '../ConfirmDialog';
export function TaskRestoreDialog({
  task,
  onClose,
}: {
  task: TaskSnapshot | null;
  onClose(): void;
}) {
  const retryTask = useWorkspace((state) => state.retryTask);
  const startingTask = useWorkspace((state) => state.startingTask);
  const closeRetryConfirmation = () => {
    if (!startingTask) onClose();
  };
  const confirmRetry = async () => {
    if (!task || startingTask) return;
    await retryTask(task.id);
    onClose();
  };
  return (
    <ConfirmDialog
      confirmLabel="载入原配置"
      description="软件只会把历史输入、参数、模型和输出策略载入转录工作台，不会立即创建或执行任务。"
      onCancel={closeRetryConfirmation}
      onConfirm={() => void confirmRetry()}
      open={task !== null}
      pending={startingTask}
      title="载入历史转录配置"
    >
      {task && (
        <dl>
          <div>
            <dt>任务</dt>
            <dd>{task.title}</dd>
          </div>
          <div>
            <dt>转录版本</dt>
            <dd>{getPreset(task.presetId).label}</dd>
          </div>
          <div>
            <dt>任务类型</dt>
            <dd>{transcriptionTaskLabel(task.draft?.effectiveParameters.task)}</dd>
          </div>
          <div>
            <dt>推理模型</dt>
            <dd>{getModelLabel(task.modelId)}</dd>
          </div>
          <div>
            <dt>媒体数量</dt>
            <dd>{task.sourceCount} 个</dd>
          </div>
          <div>
            <dt>输出策略</dt>
            <dd>{task.draft?.output.mode === 'custom' ? '自定义目录' : '跟随媒体'}</dd>
          </div>
        </dl>
      )}
    </ConfirmDialog>
  );
}

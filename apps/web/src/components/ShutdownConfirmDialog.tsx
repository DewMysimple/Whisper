import { Clock3, Power } from 'lucide-react';

import { useWorkspace } from '../state/workspace';
import { ConfirmDialog } from './ConfirmDialog';

export function ShutdownConfirmDialog() {
  const pending = useWorkspace((state) => state.pendingShutdownStart);
  const startingTask = useWorkspace((state) => state.startingTask);
  const confirmShutdownStart = useWorkspace((state) => state.confirmShutdownStart);
  const cancelShutdownStart = useWorkspace((state) => state.cancelShutdownStart);

  return (
    <ConfirmDialog
      confirmLabel="确认并开始转录"
      description="只有本次任务及当前队列全部成功后，系统才会进入 60 秒关机倒计时。失败、取消、部分失败或倒计时期间加入新任务，都会自动取消关机。"
      onCancel={cancelShutdownStart}
      onConfirm={() => void confirmShutdownStart()}
      open={pending !== null}
      pending={startingTask}
      title="确认任务完成后关闭电脑？"
      tone="danger"
    >
      <dl>
        <div>
          <dt>
            <Power size={14} aria-hidden="true" /> 执行完成
          </dt>
          <dd>关闭电脑</dd>
        </div>
        <div>
          <dt>
            <Clock3 size={14} aria-hidden="true" /> 安全倒计时
          </dt>
          <dd>60 秒，可随时返回软件取消</dd>
        </div>
      </dl>
    </ConfirmDialog>
  );
}

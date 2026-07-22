import { AlertTriangle, FileWarning } from 'lucide-react';

import { useWorkspace } from '../state/workspace';
import { ConfirmDialog } from './ConfirmDialog';

export function OverwriteConfirmDialog() {
  const pending = useWorkspace((state) => state.pendingOverwrite);
  const startingTask = useWorkspace((state) => state.startingTask);
  const confirmOverwrite = useWorkspace((state) => state.confirmOverwrite);
  const cancelOverwrite = useWorkspace((state) => state.cancelOverwrite);

  return (
    <ConfirmDialog
      confirmLabel="覆盖并开始转录"
      description="以下目标已存在或已被排队任务预留。确认只对本次任务生效，不会删除源媒体。"
      onCancel={cancelOverwrite}
      onConfirm={() => void confirmOverwrite()}
      open={pending !== null}
      pending={startingTask}
      title="确认覆盖同名输出文件？"
      tone="danger"
    >
      {pending && (
        <div className="overwrite-confirm-content">
          <div className="overwrite-confirm-summary">
            <AlertTriangle size={18} />
            <span>
              检测到 <strong>{pending.paths.length}</strong> 个冲突目标
            </span>
          </div>
          <ul className="overwrite-path-list" aria-label="同名输出目标">
            {pending.paths.map((path) => (
              <li key={path} title={path}>
                <FileWarning size={14} />
                <code>{path}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ConfirmDialog>
  );
}

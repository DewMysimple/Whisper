import { AlertTriangle, FileWarning } from 'lucide-react';

import { useWorkspace } from '../state/workspace';
import { ConfirmDialog } from './ConfirmDialog';

export function OverwriteConfirmDialog() {
  const pending = useWorkspace((state) => state.pendingOverwrite);
  const startingTask = useWorkspace((state) => state.startingTask);
  const confirmOverwrite = useWorkspace((state) => state.confirmOverwrite);
  const cancelOverwrite = useWorkspace((state) => state.cancelOverwrite);
  const skipMode = pending?.mode === 'skip';

  return (
    <ConfirmDialog
      confirmLabel={skipMode ? '跳过并开始转录' : '覆盖并开始转录'}
      description={
        skipMode
          ? '以下媒体已有输出或目标已被排队任务预留。确认后会整条跳过这些媒体，其余媒体继续执行。'
          : '以下目标已存在或已被排队任务预留。确认只对本次任务生效，不会删除源媒体。'
      }
      onCancel={cancelOverwrite}
      onConfirm={() => void confirmOverwrite()}
      open={pending !== null}
      pending={startingTask}
      title={skipMode ? '确认跳过同名媒体' : '确认覆盖同名输出文件'}
      tone={skipMode ? undefined : 'danger'}
    >
      {pending && (
        <div className="overwrite-confirm-content">
          <div className="overwrite-confirm-summary">
            <AlertTriangle size={18} />
            <span>
              检测到 <strong>{pending.paths.length}</strong> 个冲突目标
            </span>
          </div>
          {pending.finishAction === 'shutdown' && (
            <div className="overwrite-confirm-summary">
              <AlertTriangle size={18} />
              <span>
                执行完成：<strong>60 秒后关机</strong>
              </span>
            </div>
          )}
          {pending.conflicts.length > 0 ? (
            <div className="overwrite-conflict-groups" aria-label="按媒体分组的同名输出目标">
              {pending.conflicts.map((conflict) => (
                <section key={conflict.inputPath}>
                  <strong>{conflict.inputPath.split(/[/\\]/).at(-1)}</strong>
                  <ul className="overwrite-path-list">
                    {conflict.paths.map((path) => (
                      <li key={path}>
                        <FileWarning size={14} />
                        <code>{path}</code>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <ul className="overwrite-path-list" aria-label="同名输出目标">
              {pending.paths.map((path) => (
                <li key={path}>
                  <FileWarning size={14} />
                  <code>{path}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </ConfirmDialog>
  );
}

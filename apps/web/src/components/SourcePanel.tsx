import { WorkspaceEntryCard } from './WorkspaceEntryCard';
import { useLayoutEffect, useState } from 'react';

import { ClipboardPaste, FileAudio, FolderOpen, LoaderCircle } from 'lucide-react';

import { desktopBridge } from '../bridge';
import { formatMediaDuration } from '../state/mediaDuration';
import { useWorkspace } from '../state/workspace';
import './source-import-list.css';

export function SourcePanel() {
  const inputs = useWorkspace((state) => state.inputs);
  const addFiles = useWorkspace((state) => state.addFiles);
  const addDirectory = useWorkspace((state) => state.addDirectory);
  const addClipboardPaths = useWorkspace((state) => state.addClipboardPaths);
  const dragActive = useWorkspace((state) => state.draggingMedia);
  const pending = useWorkspace((state) => state.pendingImports);
  const markImportsVisible = useWorkspace((state) => state.markImportsVisible);
  const pendingCount = pending.reduce((count, batch) => count + batch.paths.length, 0);
  const [clipboardBusy, setClipboardBusy] = useState(false);

  useLayoutEffect(() => {
    markImportsVisible();
  }, [markImportsVisible, pending]);

  const pasteClipboardPaths = async () => {
    if (clipboardBusy) return;
    setClipboardBusy(true);
    try {
      await addClipboardPaths();
    } finally {
      setClipboardBusy(false);
    }
  };

  return (
    <section className="panel source-panel" aria-labelledby="source-title">
      <div className="panel-heading">
        <div>
          <p className="step-label">01 / MEDIA INPUT</p>
          <h2 id="source-title">输入来源</h2>
        </div>
      </div>

      <div
        aria-label="媒体拖放与选择区域"
        className={`drop-zone ${inputs.length > 0 ? 'has-inputs' : ''} ${
          dragActive ? 'is-dragging' : ''
        }`}
        role="group"
      >
        <div className="source-intake-copy">
          <strong role="status">
            {dragActive
              ? '松开以添加本地媒体'
              : pendingCount > 0
                ? `正在检查 ${pendingCount} 项媒体来源…`
                : '添加本地媒体'}
          </strong>
          <span>
            {desktopBridge.mode === 'tauri'
              ? '可选择文件、递归扫描文件夹，或直接拖入窗口'
              : '可选择文件或递归扫描文件夹'}
          </span>
        </div>
        <div className="source-actions" aria-label="添加输入来源">
          <button
            className="source-action-button is-primary"
            onClick={() => void addFiles()}
            type="button"
          >
            <FileAudio aria-hidden="true" size={17} />
            <span>选择媒体文件</span>
          </button>
          <button
            className="source-action-button"
            onClick={() => void addDirectory()}
            type="button"
          >
            <FolderOpen aria-hidden="true" size={17} />
            <span>添加文件夹</span>
          </button>
        </div>
      </div>

      {pending.length > 0 && (
        <ul className="source-import-list" aria-label="媒体检查进度">
          {pending.flatMap((batch) =>
            batch.paths.map((path, index) => {
              const update = batch.items[index];
              const item = update?.item;
              const label =
                update?.phase === 'inspected' && item
                  ? item.valid
                    ? `可转录 · ${item.durationSeconds === undefined ? '时长未知' : formatMediaDuration(item.durationSeconds)}`
                    : (item.detail ?? '检查失败')
                  : item?.kind === 'directory'
                    ? `检查中 · ${update?.checkedCount ?? 0}/${item.mediaCount ?? 0}`
                    : update
                      ? '检查中 · 读取时长'
                      : '已收到 · 正在发现';
              return (
                <li key={`${batch.id}-${index}`}>
                  <span title={path}>{path.split(/[\\/]/).filter(Boolean).at(-1) ?? path}</span>
                  <small title={label}>{label}</small>
                </li>
              );
            }),
          )}
        </ul>
      )}

      <WorkspaceEntryCard
        className="clipboard-intake"
        aria-busy={clipboardBusy}
        aria-label="粘贴 Windows 路径"
        disabled={clipboardBusy}
        onClick={() => void pasteClipboardPaths()}
        icon={
          clipboardBusy ? <LoaderCircle className="spin" size={15} /> : <ClipboardPaste size={15} />
        }
        label={clipboardBusy ? '正在读取 Windows 剪贴板' : '粘贴 Windows 路径'}
        title={clipboardBusy ? '正在检查路径' : '点击读取文件或文件夹路径'}
        description="自动读取当前剪贴板，检查后直接加入任务清单。"
      />
    </section>
  );
}

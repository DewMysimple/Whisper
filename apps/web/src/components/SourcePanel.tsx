import { useState } from 'react';

import { ClipboardPaste, FileAudio, FolderOpen, LoaderCircle } from 'lucide-react';

import { useWorkspace } from '../state/workspace';
import { HelpTip } from './HelpTip';

export function SourcePanel() {
  const inputs = useWorkspace((state) => state.inputs);
  const addFiles = useWorkspace((state) => state.addFiles);
  const addDirectory = useWorkspace((state) => state.addDirectory);
  const addClipboardPaths = useWorkspace((state) => state.addClipboardPaths);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);

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
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            setDragActive(false);
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        role="group"
      >
        <div className="source-intake-copy">
          <strong>{dragActive ? '松开即可添加到媒体队列' : '添加本地媒体'}</strong>
          <span>可选择文件、递归扫描文件夹，或直接拖放到此处</span>
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

      <button
        aria-busy={clipboardBusy}
        aria-label="粘贴 Windows 路径"
        className="path-entry clipboard-intake"
        disabled={clipboardBusy}
        onClick={() => void pasteClipboardPaths()}
        type="button"
      >
        <span className="path-entry-toggle">
          {clipboardBusy ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <ClipboardPaste size={15} />
          )}
          {clipboardBusy ? '正在读取 Windows 剪贴板' : '粘贴 Windows 路径'}
        </span>
        <span className="path-entry-idle-copy">
          <strong>{clipboardBusy ? '正在检查路径' : '点击读取文件或文件夹路径'}</strong>
          <span>自动读取当前剪贴板，检查后直接加入媒体队列。</span>
        </span>
      </button>

      <div className="input-hint">
        <HelpTip id="path-processing-help" label="查看路径处理说明">
          <strong>路径处理</strong>
          路径始终按结构化字符串处理，不经过 shell，也不会按空格拆分。
        </HelpTip>
      </div>
    </section>
  );
}

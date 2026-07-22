import { useState } from 'react';

import { ChevronDown, FileAudio, FolderOpen, Plus, Trash2 } from 'lucide-react';

import { useWorkspace } from '../state/workspace';
import { HelpTip } from './HelpTip';

export function SourcePanel() {
  const inputs = useWorkspace((state) => state.inputs);
  const addFiles = useWorkspace((state) => state.addFiles);
  const addDirectory = useWorkspace((state) => state.addDirectory);
  const addPastedPaths = useWorkspace((state) => state.addPastedPaths);
  const clearInputs = useWorkspace((state) => state.clearInputs);
  const [pastedPaths, setPastedPaths] = useState('');
  const [pathEntryOpen, setPathEntryOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const submitPastedPaths = async () => {
    const paths = pastedPaths
      .split(/\r?\n/)
      .map((path) => path.trim())
      .filter(Boolean);
    if (paths.length === 0) return;
    await addPastedPaths(paths);
    setPastedPaths('');
  };

  return (
    <section className="panel source-panel" aria-labelledby="source-title">
      <div className="panel-heading">
        <div>
          <p className="step-label">01 / MEDIA INPUT</p>
          <h2 id="source-title">输入来源</h2>
        </div>
        {inputs.length > 0 && (
          <button className="quiet-button" onClick={clearInputs} type="button">
            <Trash2 size={15} /> 清空
          </button>
        )}
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

      <div className={`path-entry ${pathEntryOpen ? 'is-open' : ''}`}>
        <button
          aria-expanded={pathEntryOpen}
          className="path-entry-toggle"
          onClick={() => setPathEntryOpen((open) => !open)}
          type="button"
        >
          <Plus size={15} />
          粘贴 Windows 路径
          <ChevronDown aria-hidden="true" className="path-entry-chevron" size={15} />
        </button>
        {pathEntryOpen && (
          <div className="path-paste-row">
            <div className="directory-path-input">
              <textarea
                aria-label="粘贴 Windows 路径"
                autoFocus
                onChange={(event) => setPastedPaths(event.target.value)}
                rows={2}
                value={pastedPaths}
              />
              {pastedPaths.length === 0 && <span aria-hidden="true">Directory Path</span>}
              <small>多个完整路径请每行一个，例如 D:\媒体素材\访谈 01.mp4</small>
            </div>
            <button
              className="secondary-button"
              disabled={pastedPaths.trim().length === 0}
              onClick={() => void submitPastedPaths()}
              type="button"
            >
              <Plus size={17} /> 添加路径
            </button>
          </div>
        )}
      </div>

      <div className="input-hint">
        <HelpTip id="path-processing-help" label="查看路径处理说明">
          <strong>路径处理</strong>
          路径始终按结构化字符串处理，不经过 shell，也不会按空格拆分。
        </HelpTip>
      </div>
    </section>
  );
}

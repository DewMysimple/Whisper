import { useState } from 'react';

import { FileAudio, FolderOpen, Plus, Quote, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { useWorkspace } from '../state/workspace';

export function SourcePanel() {
  const inputs = useWorkspace((state) => state.inputs);
  const addFiles = useWorkspace((state) => state.addFiles);
  const addDirectory = useWorkspace((state) => state.addDirectory);
  const addPastedPaths = useWorkspace((state) => state.addPastedPaths);
  const removeInput = useWorkspace((state) => state.removeInput);
  const clearInputs = useWorkspace((state) => state.clearInputs);
  const [pastedPaths, setPastedPaths] = useState('');

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
          <p className="step-label">01 · INPUT</p>
          <h2 id="source-title">输入来源</h2>
        </div>
        {inputs.length > 0 && (
          <button className="quiet-button" onClick={clearInputs} type="button">
            <Trash2 size={15} /> 清空
          </button>
        )}
      </div>

      <div className={`drop-zone ${inputs.length > 0 ? 'has-inputs' : ''}`}>
        <div className="drop-icon">
          <Plus size={24} />
        </div>
        <div>
          <strong>
            {inputs.length > 0 ? `已加入 ${inputs.length} 个来源` : '将媒体拖放到这里'}
          </strong>
          <span>支持视频、音频、文件夹、拖放与带引号的 Windows 路径</span>
        </div>
        <div className="source-actions">
          <button className="secondary-button" onClick={() => void addFiles()} type="button">
            <FileAudio size={17} /> 选择多个文件
          </button>
          <button className="secondary-button" onClick={() => void addDirectory()} type="button">
            <FolderOpen size={17} /> 添加文件夹
          </button>
        </div>
      </div>

      <div className="path-paste-row">
        <textarea
          aria-label="粘贴 Windows 路径"
          onChange={(event) => setPastedPaths(event.target.value)}
          placeholder={
            '粘贴完整 Windows 路径；多个路径请每行一个\n例如："D:\\媒体素材\\访谈 01.mp4"'
          }
          rows={2}
          value={pastedPaths}
        />
        <button
          className="secondary-button"
          disabled={pastedPaths.trim().length === 0}
          onClick={() => void submitPastedPaths()}
          type="button"
        >
          <Plus size={17} /> 添加路径
        </button>
      </div>

      <AnimatePresence initial={false}>
        {inputs.length > 0 && (
          <motion.div
            animate={{ opacity: 1, height: 'auto' }}
            className="source-list"
            exit={{ opacity: 0, height: 0 }}
            initial={{ opacity: 0, height: 0 }}
          >
            {inputs.map((source) => (
              <div className={`source-row ${source.valid ? '' : 'is-invalid'}`} key={source.id}>
                <div className="file-badge">
                  {source.kind === 'file' ? <FileAudio size={17} /> : <FolderOpen size={17} />}
                </div>
                <div className="source-copy">
                  <strong>{source.path.split(/[/\\]/).at(-1)}</strong>
                  <span>{source.path}</span>
                  {source.detail && <em>{source.detail}</em>}
                </div>
                <button
                  aria-label={`移除 ${source.path}`}
                  className="icon-button"
                  onClick={() => removeInput(source.id)}
                  type="button"
                >
                  <X size={17} />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="input-hint">
        <Quote size={15} />
        <span>路径始终按结构化字符串处理，不经过 shell，也不会按空格拆分。</span>
      </div>
    </section>
  );
}

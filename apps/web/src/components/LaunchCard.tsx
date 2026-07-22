import { ChevronRight, Layers3, Play, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { getPreset } from '../data/presets';
import { useWorkspace } from '../state/workspace';
import { ConfirmDialog } from './ConfirmDialog';

function sourceBadge(path: string, kind: 'file' | 'directory'): string {
  if (kind === 'directory') return 'DIR';
  const name = path.split(/[/\\]/).at(-1) ?? path;
  const extension = name.includes('.') ? name.split('.').at(-1) : 'MEDIA';
  return (extension ?? 'MEDIA').slice(0, 5).toUpperCase();
}

export function LaunchCard() {
  const inputs = useWorkspace((state) => state.inputs);
  const selectedPresetId = useWorkspace((state) => state.selectedPresetId);
  const overrides = useWorkspace((state) => state.overrides);
  const startTask = useWorkspace((state) => state.startTask);
  const removeInput = useWorkspace((state) => state.removeInput);
  const hostStatus = useWorkspace((state) => state.hostStatus);
  const startingTask = useWorkspace((state) => state.startingTask);
  const output = useWorkspace((state) => state.output);
  const profileMode = useWorkspace((state) => state.profileMode);
  const activeView = useWorkspace((state) => state.activeView);
  const [presetConfirmationOpen, setPresetConfirmationOpen] = useState(false);
  const hasInvalidInput = inputs.some((input) => !input.valid);
  const needsOutputRoot = output.mode === 'custom' && output.rootDirectory === null;
  const hasOutputTarget = output.txtEnabled || output.markdownEnabled || output.srtEnabled;
  const canStart =
    inputs.length > 0 &&
    !hasInvalidInput &&
    !needsOutputRoot &&
    hasOutputTarget &&
    hostStatus.state === 'ready' &&
    !startingTask;
  const needsPresetConfirmation = selectedPresetId === 'cn' || selectedPresetId === 'en_v1';
  const preset = getPreset(selectedPresetId);
  const mediaCount = inputs.reduce((total, input) => total + (input.mediaCount ?? 1), 0);

  const requestStart = useCallback(() => {
    if (!canStart) return;
    if (needsPresetConfirmation) {
      setPresetConfirmationOpen(true);
      return;
    }
    void startTask();
  }, [canStart, needsPresetConfirmation, startTask]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        activeView !== 'workspace' ||
        presetConfirmationOpen ||
        event.repeat ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        event.key !== 'Enter'
      ) {
        return;
      }
      event.preventDefault();
      requestStart();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [activeView, presetConfirmationOpen, requestStart]);

  const confirmPresetStart = useCallback(async () => {
    await startTask();
    setPresetConfirmationOpen(false);
  }, [startTask]);

  const closePresetConfirmation = useCallback(() => {
    if (!startingTask) setPresetConfirmationOpen(false);
  }, [startingTask]);

  return (
    <section className="launch-card" aria-labelledby="launch-title">
      <div className="launch-action">
        <div className="launch-action-heading">
          <p className="step-label">READY TO TRANSCRIBE</p>
          <kbd>CTRL + ENTER</kbd>
        </div>
        <h2>{inputs.length > 0 ? `${mediaCount} 个媒体已就绪` : '等待输入来源'}</h2>
        <p>
          {needsOutputRoot
            ? '请选择真实输出目录'
            : hasInvalidInput
              ? '请先处理无效输入'
              : !hasOutputTarget
                ? '请至少启用一种输出格式'
                : `${Object.keys(overrides).length > 0 ? '自定义参数' : '稳定 preset'} · ${preset.label} · ${profileMode === 'subtitle' ? 'SRT 字幕' : 'TXT / MD 文本'} · 本地离线处理`}
        </p>
        <button
          className="primary-button"
          disabled={!canStart}
          onClick={requestStart}
          type="button"
        >
          <Play fill="currentColor" size={17} />
          {startingTask
            ? '正在准备本地模型…'
            : profileMode === 'subtitle'
              ? '开始生成 SRT 字幕'
              : '开始本地转录'}
          <ChevronRight size={17} />
        </button>
      </div>
      <div className="launch-queue">
        <div className="launch-queue-heading">
          <div>
            <p className="step-label">MEDIA QUEUE</p>
            <h3 id="launch-title">媒体队列</h3>
          </div>
          <span>
            {inputs.length} 项 · {mediaCount} 个媒体
          </span>
        </div>
        <div className="launch-queue-list" aria-label="待转录媒体队列" tabIndex={0}>
          {inputs.length === 0 ? (
            <div className="launch-queue-empty">
              <Layers3 size={19} />
              <span>尚未加入媒体</span>
            </div>
          ) : (
            inputs.map((source) => (
              <div className={`source-row ${source.valid ? '' : 'is-invalid'}`} key={source.id}>
                <div className="file-badge">{sourceBadge(source.path, source.kind)}</div>
                <div className="source-copy">
                  <strong>{source.path.split(/[/\\]/).at(-1)}</strong>
                  <span>
                    {source.path}
                    {source.kind === 'directory' && source.mediaCount !== undefined
                      ? ` · 共 ${source.mediaCount} 个媒体文件`
                      : source.detail
                        ? ` · ${source.detail}`
                        : ''}
                  </span>
                </div>
                <button
                  aria-label={`移除 ${source.path}`}
                  className="icon-button"
                  onClick={() => removeInput(source.id)}
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      <ConfirmDialog
        confirmLabel="继续转录"
        description={`当前选择“${preset.label}”，该版本未启用防幻觉优化，静音、噪声或长停顿片段可能产生重复或无效文本。`}
        onCancel={closePresetConfirmation}
        onConfirm={() => void confirmPresetStart()}
        open={presetConfirmationOpen}
        pending={startingTask}
        title="确认使用标准转录版本？"
      >
        <dl>
          <div>
            <dt>当前工作区</dt>
            <dd>{profileMode === 'subtitle' ? 'SRT 字幕识别' : 'TXT / Markdown 文本识别'}</dd>
          </div>
          <div>
            <dt>转录版本</dt>
            <dd>{preset.label}</dd>
          </div>
          <div>
            <dt>媒体数量</dt>
            <dd>{mediaCount} 个</dd>
          </div>
        </dl>
      </ConfirmDialog>
    </section>
  );
}

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Files,
  FolderOutput,
  Play,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { getPreset, transcriptionTaskLabel } from '../data/presets';
import { getModelLabel } from '../data/models';
import { formatMediaDuration, summarizeInputDurations } from '../state/mediaDuration';
import { useWorkspace } from '../state/workspace';
import { ConfirmDialog } from './ConfirmDialog';

function sourceBadge(path: string, kind: 'file' | 'directory'): string {
  if (kind === 'directory') return 'DIR';
  const name = path.split(/[/\\]/).at(-1) ?? path;
  const extension = name.includes('.') ? name.split('.').at(-1) : 'MEDIA';
  return (extension ?? 'MEDIA').slice(0, 5).toUpperCase();
}

function durationChecklistLabel(knownSeconds: number, unknownCount: number): string {
  const roundedSeconds = Math.max(0, Math.round(knownSeconds));
  const exactSeconds = `${roundedSeconds.toLocaleString('zh-CN')} 秒`;
  if (unknownCount > 0) {
    return roundedSeconds > 0
      ? `${formatMediaDuration(roundedSeconds)} · 已知 ${exactSeconds}，另有 ${unknownCount} 个未知`
      : `${unknownCount} 个媒体时长未知`;
  }
  return `${formatMediaDuration(roundedSeconds)} · ${exactSeconds}`;
}

const CONFLICT_POLICY_LABEL = {
  confirm_overwrite: '同名时执行前确认覆盖',
  confirm_skip: '同名时执行前确认跳过',
  auto_rename: '同名时自动安全重命名',
} as const;

const HOST_STATUS_LABEL = {
  starting: '本地 Worker 启动中',
  ready: '本地 Worker 已就绪',
  stopping: '本地 Worker 正在停止',
  stopped: '本地 Worker 已停止',
  failed: '本地 Worker 连接失败',
} as const;

function openChecklistTarget(panelSelector: string, controlSelector: string): void {
  const panel = document.querySelector<HTMLElement>(panelSelector);
  if (panel === null) return;

  if (typeof panel.scrollIntoView === 'function') {
    panel.scrollIntoView({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    });
  }
  panel.querySelector<HTMLElement>(controlSelector)?.focus({ preventScroll: true });
}

export function LaunchCard() {
  const inputs = useWorkspace((state) => state.inputs);
  const selectedPresetId = useWorkspace((state) => state.selectedPresetId);
  const overrides = useWorkspace((state) => state.overrides);
  const parameters = useWorkspace((state) => state.parameters);
  const startTask = useWorkspace((state) => state.startTask);
  const removeInput = useWorkspace((state) => state.removeInput);
  const clearInputs = useWorkspace((state) => state.clearInputs);
  const hostStatus = useWorkspace((state) => state.hostStatus);
  const startingTask = useWorkspace((state) => state.startingTask);
  const output = useWorkspace((state) => state.output);
  const profileMode = useWorkspace((state) => state.profileMode);
  const activeView = useWorkspace((state) => state.activeView);
  const selectedModelId = useWorkspace((state) => state.selectedModelId);
  const pendingOverwrite = useWorkspace((state) => state.pendingOverwrite);
  const pendingShutdownStart = useWorkspace((state) => state.pendingShutdownStart);
  const finishAction = useWorkspace((state) => state.finishAction);
  const [presetConfirmationOpen, setPresetConfirmationOpen] = useState(false);
  const hasInvalidInput = inputs.some((input) => !input.valid);
  const needsOutputRoot = output.mode === 'custom' && output.rootDirectory === null;
  const hasOutputTarget = output.txtEnabled || output.markdownEnabled || output.srtEnabled;
  const selectedOutputFormats =
    profileMode === 'subtitle'
      ? [output.srtEnabled ? 'SRT' : null, output.txtEnabled ? 'TXT' : null]
      : [output.txtEnabled ? 'TXT' : null, output.markdownEnabled ? 'MD' : null];
  const outputSummary = selectedOutputFormats.filter((format) => format !== null).join(' + ');
  const canStart =
    inputs.length > 0 &&
    !hasInvalidInput &&
    !needsOutputRoot &&
    hasOutputTarget &&
    hostStatus.state === 'ready' &&
    !startingTask &&
    pendingOverwrite === null &&
    pendingShutdownStart === null;
  const needsPresetConfirmation = selectedPresetId === 'cn' || selectedPresetId === 'en_v1';
  const preset = getPreset(selectedPresetId);
  const mediaCount = inputs.reduce((total, input) => total + (input.mediaCount ?? 1), 0);
  const durationSummary = summarizeInputDurations(inputs);
  const durationChecklist = durationChecklistLabel(
    durationSummary.knownSeconds,
    durationSummary.unknownCount,
  );
  const usesCustomOutput = output.mode === 'custom';
  const outputLocationLabel = usesCustomOutput
    ? (output.rootDirectory ?? '尚未选择自选目录')
    : '跟随每个媒体文件';
  const checklistPending = pendingOverwrite !== null || pendingShutdownStart !== null;
  const checklistStatus = startingTask
    ? '正在准备'
    : checklistPending
      ? '等待确认'
      : canStart
        ? '可以执行'
        : '待补充';
  const readinessMessage = needsOutputRoot
    ? '还需选择真实输出目录，完成后即可执行。'
    : hasInvalidInput
      ? '输入中存在无效路径，请先在清单中处理。'
      : !hasOutputTarget
        ? '还需启用至少一种输出格式，完成后即可执行。'
        : inputs.length === 0
          ? null
          : hostStatus.state !== 'ready'
            ? `${HOST_STATUS_LABEL[hostStatus.state]}，暂时无法执行任务。`
            : '任务清单已更新，确认无误后开始本地处理。';

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

  const openProfileConfiguration = useCallback(() => {
    const panelSelector =
      profileMode === 'subtitle'
        ? '.subtitle-profile-panel'
        : '.preset-panel:not(.subtitle-profile-panel)';
    openChecklistTarget(panelSelector, '.preset-card[aria-pressed="true"]');
  }, [profileMode]);

  return (
    <section className="launch-card" aria-labelledby="launch-title">
      <div className="launch-unified">
        <div className="panel-heading launch-heading">
          <div>
            <p className="step-label">PRE-FLIGHT CHECKLIST</p>
            <h2 id="launch-title">{inputs.length > 0 ? '任务清单已就绪' : '等待输入来源'}</h2>
          </div>
          <span className={`preflight-status ${canStart ? 'is-ready' : ''}`}>
            {canStart ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {checklistStatus}
          </span>
        </div>
        <div aria-label="执行前清单" className="preflight-list">
          <button
            aria-label="前往版本与模型配置"
            className="selection-card preflight-item"
            onClick={openProfileConfiguration}
            type="button"
          >
            <span className="preflight-icon" aria-hidden="true">
              <Settings2 size={16} />
            </span>
            <div className="preflight-copy">
              <span className="preflight-key">版本与模型</span>
              <strong>
                {preset.label}
                {Object.keys(overrides).length > 0 ? ' · 自定义参数' : ''}
              </strong>
              <small>{getModelLabel(selectedModelId)} · 本地离线处理</small>
            </div>
          </button>

          <button
            aria-label="前往输入来源配置"
            className={`selection-card preflight-item ${inputs.length === 0 || hasInvalidInput ? 'needs-attention' : ''}`}
            onClick={() => openChecklistTarget('.source-panel', '.source-action-button.is-primary')}
            type="button"
          >
            <span className="preflight-icon" aria-hidden="true">
              <Files size={16} />
            </span>
            <div className="preflight-copy">
              <span className="preflight-key">媒体信息</span>
              <strong>{mediaCount} 个媒体</strong>
              <small>
                {inputs.length} 项输入来源 · {durationChecklist}
              </small>
            </div>
          </button>

          <button
            aria-label="前往输出策略配置"
            className={`selection-card preflight-item ${needsOutputRoot || !hasOutputTarget ? 'needs-attention' : ''}`}
            onClick={() => openChecklistTarget('.output-panel', '.output-location-action')}
            type="button"
          >
            <span className="preflight-icon" aria-hidden="true">
              <FolderOutput size={16} />
            </span>
            <div className="preflight-copy">
              <span className="preflight-key">输出策略</span>
              <strong>{outputSummary || '尚未选择输出格式'}</strong>
              <small
                className={`preflight-detail-lines ${usesCustomOutput ? 'preflight-path' : ''}`}
              >
                <span>{outputLocationLabel}</span>
                <span>{CONFLICT_POLICY_LABEL[output.conflictPolicy]}</span>
              </small>
            </div>
          </button>

          <button
            aria-label="前往执行方式配置"
            className={`selection-card preflight-item ${hostStatus.state !== 'ready' ? 'needs-attention' : ''}`}
            onClick={() =>
              openChecklistTarget(
                '.output-panel',
                '.finish-action-options > button[aria-pressed="true"]',
              )
            }
            type="button"
          >
            <span className="preflight-icon" aria-hidden="true">
              {hostStatus.state === 'ready' ? (
                <CheckCircle2 size={16} />
              ) : (
                <AlertTriangle size={16} />
              )}
            </span>
            <div className="preflight-copy">
              <span className="preflight-key">执行方式</span>
              <strong>{transcriptionTaskLabel(parameters.task)}</strong>
              <small className="preflight-detail-lines">
                <span>{finishAction === 'shutdown' ? '完成后关机' : '完成后无操作'}</span>
                <span>{HOST_STATUS_LABEL[hostStatus.state]}</span>
              </small>
            </div>
          </button>
        </div>

        {readinessMessage && <p className="launch-summary">{readinessMessage}</p>}

        {inputs.length > 0 && (
          <details className="preflight-sources">
            <summary>
              <span>查看并管理 {inputs.length} 项输入来源</span>
              <ChevronDown aria-hidden="true" size={15} />
            </summary>
            <div aria-label="待转录输入来源" className="preflight-source-list">
              <div className="preflight-source-tools">
                <span>{mediaCount} 个媒体将按清单设置统一处理</span>
                <button onClick={clearInputs} type="button">
                  <Trash2 size={13} /> 清空输入
                </button>
              </div>
              {inputs.map((source) => (
                <div
                  className={`preflight-source ${source.valid ? '' : 'is-invalid'}`}
                  key={source.id}
                >
                  <span className="file-badge">{sourceBadge(source.path, source.kind)}</span>
                  <span className="preflight-source-copy">
                    <strong>{source.path.split(/[/\\]/).at(-1)}</strong>
                    <small>
                      {source.kind === 'directory' && source.mediaCount !== undefined
                        ? `${source.mediaCount} 个媒体`
                        : source.detail || '单个媒体'}
                      {' · '}
                      {source.unknownDurationCount && source.unknownDurationCount > 0
                        ? source.durationSeconds !== undefined
                          ? `已知 ${formatMediaDuration(source.durationSeconds)}，另有 ${source.unknownDurationCount} 个未知`
                          : `${source.unknownDurationCount} 个时长未知`
                        : formatMediaDuration(source.durationSeconds)}
                    </small>
                  </span>
                  <button
                    aria-label={`移除 ${source.path}`}
                    className="icon-button"
                    onClick={() => removeInput(source.id)}
                    type="button"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}

        <button
          className="primary-button launch-submit"
          disabled={!canStart}
          onClick={requestStart}
          type="button"
        >
          <span className="launch-submit-label">
            <Play fill="currentColor" size={17} />
            {startingTask
              ? '正在准备本地模型…'
              : profileMode === 'subtitle'
                ? `开始生成 ${outputSummary}`
                : '开始本地转录'}
            <ChevronRight size={17} />
          </span>
          <kbd aria-hidden="true" className="launch-shortcut">
            CTRL + ENTER
          </kbd>
        </button>
      </div>
      <ConfirmDialog
        confirmLabel="继续转录"
        description={`当前选择“${preset.label}”，该版本未启用防幻觉优化，静音、噪声或长停顿片段可能产生重复或无效文本。`}
        onCancel={closePresetConfirmation}
        onConfirm={() => void confirmPresetStart()}
        open={presetConfirmationOpen}
        pending={startingTask}
        title="确认使用标准转录版本"
      >
        <dl>
          <div>
            <dt>当前工作区</dt>
            <dd>{profileMode === 'subtitle' ? outputSummary : 'TXT / Markdown 文本识别'}</dd>
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

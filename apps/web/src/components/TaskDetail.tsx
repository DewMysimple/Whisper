import { FileText, FolderOpen, RotateCcw, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { getPreset, transcriptionTaskLabel } from '../data/presets';
import { getModelLabel } from '../data/models';
import { formatResolvedHardware } from '../state/hardware';
import {
  formatDurationSummary,
  formatMediaDuration,
  taskDurationSummary,
} from '../state/mediaDuration';
import { formatTaskCreatedAt } from '../state/taskHistory';
import { canResumeTask, useWorkspace } from '../state/workspace';
import { ConfirmDialog } from './ConfirmDialog';

export function TaskDetail() {
  const selectedTaskId = useWorkspace((state) => state.selectedTaskId);
  const task = useWorkspace((state) =>
    state.tasks.find((item) => item.id === state.selectedTaskId),
  );
  const preview = useWorkspace((state) => state.outputPreview);
  const previewLoading = useWorkspace((state) => state.previewLoading);
  const selectTask = useWorkspace((state) => state.selectTask);
  const retryTask = useWorkspace((state) => state.retryTask);
  const resumeTask = useWorkspace((state) => state.resumeTask);
  const revealTaskOutput = useWorkspace((state) => state.revealTaskOutput);
  const startingTask = useWorkspace((state) => state.startingTask);
  const [retryConfirmationOpen, setRetryConfirmationOpen] = useState(false);

  const closeRetryConfirmation = useCallback(() => {
    if (!startingTask) setRetryConfirmationOpen(false);
  }, [startingTask]);

  const confirmRetry = useCallback(async () => {
    if (selectedTaskId === null) return;
    await retryTask(selectedTaskId);
    setRetryConfirmationOpen(false);
  }, [retryTask, selectedTaskId]);

  if (selectedTaskId === null || task === undefined) return null;
  const parameters = task.draft?.effectiveParameters;
  const resumable = canResumeTask(task);
  const qualityMedia = (task.mediaStates ?? []).filter(
    (media) => media.qualityDiagnostics !== undefined,
  );
  const lowConfidenceSegments = qualityMedia
    .flatMap((media) =>
      (media.qualityDiagnostics?.segments ?? []).map((segment) => ({
        mediaPath: media.path,
        segment,
      })),
    )
    .slice(0, 50);
  const totalLowConfidence = qualityMedia.reduce(
    (total, media) => total + (media.qualityDiagnostics?.lowConfidenceCount ?? 0),
    0,
  );
  const totalFallbackSegments = qualityMedia.reduce(
    (total, media) => total + (media.qualityDiagnostics?.fallbackSegmentCount ?? 0),
    0,
  );
  const totalReplacedRegions = qualityMedia.reduce(
    (total, media) => total + (media.qualityDiagnostics?.replacedRegionCount ?? 0),
    0,
  );
  const totalReviewRegions = qualityMedia.reduce(
    (total, media) => total + (media.qualityDiagnostics?.reviewRegionCount ?? 0),
    0,
  );
  const totalRejectedRegions = qualityMedia.reduce(
    (total, media) => total + (media.qualityDiagnostics?.rejectedRegionCount ?? 0),
    0,
  );

  return (
    <div className="detail-backdrop" onMouseDown={() => void selectTask(null)}>
      <aside
        aria-labelledby="task-detail-title"
        aria-modal="true"
        className="task-detail"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <p className="step-label">TASK SNAPSHOT</p>
            <h2 id="task-detail-title">{task.title}</h2>
          </div>
          <button
            aria-label="关闭任务详情"
            autoFocus
            className="round-button"
            onClick={() => void selectTask(null)}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="detail-status-line">
          <span
            className={`status-badge ${task.outputAvailability === 'missing' ? 'failed' : task.status}`}
          >
            {task.outputAvailability === 'missing' ? 'OUTPUT MISSING' : task.status.toUpperCase()}
          </span>
          <span>{getPreset(task.presetId).label}</span>
          <span>{transcriptionTaskLabel(task.draft?.effectiveParameters.task)}</span>
          <span>{recognitionStrategyLabel(task.recognitionStrategy)}</span>
          <span>{getModelLabel(task.modelId)}</span>
          <span>{formatResolvedHardware(task.hardware)}</span>
          <span>{formatTaskCreatedAt(task.createdAt)}</span>
          <span>{task.elapsed}</span>
          <span>{formatDurationSummary(taskDurationSummary(task))}</span>
          <span>{task.outputAvailability === 'missing' ? '输出文件已丢失或移动' : task.stage}</span>
        </div>

        <section className="detail-section">
          <h3>输入快照</h3>
          {task.draft?.inputs.map((input) => (
            <code key={`${input.kind}-${input.path}`}>
              {input.path}
              {input.kind === 'directory' && input.mediaCount !== undefined
                ? ` · 共 ${input.mediaCount} 个媒体文件`
                : ''}
              {' · '}
              {input.unknownDurationCount && input.unknownDurationCount > 0
                ? input.durationSeconds !== undefined
                  ? `已知 ${formatMediaDuration(input.durationSeconds)} + ${input.unknownDurationCount} 个未知`
                  : `${input.unknownDurationCount} 个时长未知`
                : `时长 ${formatMediaDuration(input.durationSeconds)}`}
            </code>
          )) ?? <span>旧任务没有保存输入快照。</span>}
        </section>

        <section className="detail-section">
          <h3>生效参数</h3>
          {parameters?.hotwords?.trim() ? (
            <p className="parameter-status-note">
              术语提示已启用 · {countHotwords(parameters.hotwords)} 个词条 ·
              仅用于识别提示，不会强制替换
            </p>
          ) : null}
          {parameters ? (
            <dl className="parameter-snapshot">
              {Object.entries(parameters).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : task.outputAvailability === 'missing' ? (
            <span>记录中的输出文件已被删除、移动或改名，无法预览。</span>
          ) : (
            <span>旧任务没有保存参数快照。</span>
          )}
        </section>

        <section className="detail-section quality-diagnostics">
          <h3>识别质量诊断</h3>
          {qualityMedia.length === 0 ? (
            <span>旧任务或尚未完成识别的媒体没有质量诊断。</span>
          ) : (
            <>
              <p className="quality-disclaimer">
                以下片段仅表示解码指标触发复核条件，不等同于已经识别错误，正文不会被自动修改。
              </p>
              <div className="quality-summary-grid">
                <span>
                  已诊断媒体 <strong>{qualityMedia.length}</strong>
                </span>
                <span>
                  需复核片段 <strong>{totalLowConfidence}</strong>
                </span>
                <span>
                  温度回退片段 <strong>{totalFallbackSegments}</strong>
                </span>
                <span>
                  自动采用候选 <strong>{totalReplacedRegions}</strong>
                </span>
                <span>
                  保留原文区间 <strong>{totalReviewRegions}</strong>
                </span>
                <span>
                  拒绝候选 <strong>{totalRejectedRegions}</strong>
                </span>
              </div>
              {qualityMedia.map((media) => {
                const diagnostics = media.qualityDiagnostics!;
                return (
                  <div className="quality-media-summary" key={media.path}>
                    <strong>{media.path.split(/[\\/]/).pop()}</strong>
                    <span>
                      主语言 {diagnostics.detectedLanguage ?? '未知'}
                      {diagnostics.languageProbability === null
                        ? ''
                        : ` · 置信度 ${(diagnostics.languageProbability * 100).toFixed(1)}%`}
                    </span>
                    <span>
                      {diagnostics.segmentCount} 段 · 最高温度{' '}
                      {diagnostics.maxTemperature.toFixed(1)}
                    </span>
                    <span>
                      {recognitionStrategyLabel(diagnostics.recognitionStrategy)} ·{' '}
                      {diagnostics.secondaryPassCount ?? 0} 次局部复识别
                    </span>
                    {diagnostics.languageRegions?.length ? (
                      <div className="language-region-list">
                        {diagnostics.languageRegions.map((region) => (
                          <article
                            className={`language-region is-${region.decision}`}
                            key={`${media.path}-${region.start}-${region.end}`}
                          >
                            <header>
                              <strong>{formatDiagnosticRange(region.start, region.end)}</strong>
                              <span>{languageDecisionLabel(region.decision)}</span>
                            </header>
                            <small>
                              {region.topLanguage} {(region.topProbability * 100).toFixed(1)}% · EN{' '}
                              {(region.englishProbability * 100).toFixed(1)}% · ZH{' '}
                              {(region.chineseProbability * 100).toFixed(1)}%
                            </small>
                            <p>
                              <b>第一遍</b> {region.primaryText || '（无可显示文字）'}
                            </p>
                            {region.candidateText ? (
                              <p>
                                <b>英文候选</b> {region.candidateText}
                              </p>
                            ) : null}
                            {region.reason ? (
                              <small>处理依据：{languageRegionReasonLabel(region.reason)}</small>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    ) : null}
                    {diagnostics.detailCandidates?.length ? (
                      <div className="language-region-list detail-candidate-list">
                        {diagnostics.detailCandidates.map((candidate) => (
                          <article
                            className={`language-region is-${candidate.decision}`}
                            key={`${media.path}-detail-${candidate.start}-${candidate.end}`}
                          >
                            <header>
                              <strong>
                                {formatDiagnosticRange(candidate.start, candidate.end)}
                              </strong>
                              <span>{detailDecisionLabel(candidate.decision)}</span>
                            </header>
                            <small>
                              ZH {(candidate.chineseProbability * 100).toFixed(1)}% · 词概率{' '}
                              {formatProbabilityChange(
                                candidate.primaryWordProbability,
                                candidate.candidateWordProbability,
                              )}{' '}
                              · logprob{' '}
                              {formatProbabilityChange(
                                candidate.primaryLogProbability,
                                candidate.candidateLogProbability,
                              )}
                            </small>
                            <p>
                              <b>第一遍</b> {candidate.primaryText || '（无可显示文字）'}
                            </p>
                            {candidate.candidateText ? (
                              <p>
                                <b>中文候选</b> {candidate.candidateText}
                              </p>
                            ) : null}
                            {candidate.recoveredHotwords.length ? (
                              <small>恢复术语：{candidate.recoveredHotwords.join('、')}</small>
                            ) : null}
                            {candidate.reason ? (
                              <small>
                                处理依据：{detailCandidateReasonLabel(candidate.reason)}
                              </small>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    ) : null}
                    {diagnostics.hotwordAudit ? (
                      <div className="hotword-audit">
                        <strong>
                          术语命中 {diagnostics.hotwordAudit.matchedCount} /{' '}
                          {diagnostics.hotwordAudit.termCount}
                        </strong>
                        <span>
                          已命中：
                          {diagnostics.hotwordAudit.matchedTerms.join('、') || '无'}
                        </span>
                        <span>
                          未在结果中出现：
                          {diagnostics.hotwordAudit.missingTerms.join('、') || '无'}
                        </span>
                        <small>未命中不等同于识别错误，软件不会自动插入或替换术语。</small>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {lowConfidenceSegments.length > 0 && (
                <div className="quality-segment-list">
                  {lowConfidenceSegments.map(({ mediaPath, segment }) => (
                    <article
                      className="quality-segment"
                      key={`${mediaPath}-${segment.index}-${segment.start}`}
                    >
                      <header>
                        <strong>{formatDiagnosticRange(segment.start, segment.end)}</strong>
                        <span>{segment.reasons.map(qualityReasonLabel).join(' · ')}</span>
                      </header>
                      <p>{segment.text || '（该片段没有可显示文字）'}</p>
                      <small>
                        temperature {formatDiagnosticNumber(segment.temperature)} · avg logprob{' '}
                        {formatDiagnosticNumber(segment.avgLogProbability)} · compression{' '}
                        {formatDiagnosticNumber(segment.compressionRatio)} · no-speech{' '}
                        {formatDiagnosticNumber(segment.noSpeechProbability)}
                      </small>
                    </article>
                  ))}
                  {totalLowConfidence > lowConfidenceSegments.length && (
                    <small>
                      另有 {totalLowConfidence - lowConfidenceSegments.length} 条未在详情中展开。
                    </small>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        {task.outputs && task.outputs.length > 0 && (
          <section className="detail-section">
            <h3>输出文件</h3>
            {task.outputs.map((output) => (
              <code key={output}>{output}</code>
            ))}
          </section>
        )}

        <section className="detail-section preview-section">
          <h3>
            <FileText size={16} /> 输出预览
          </h3>
          {previewLoading ? (
            <span>正在读取本地输出…</span>
          ) : preview ? (
            <>
              <pre>{preview.content}</pre>
              {preview.truncated && <small>预览已截断为前 128 KiB。</small>}
            </>
          ) : (
            <span>任务完成后可预览 TXT、Markdown 或 SRT。</span>
          )}
        </section>

        <footer>
          {task.draft && task.status !== 'running' && task.status !== 'queued' && (
            <button
              className="secondary-button"
              onClick={() => {
                if (resumable) {
                  void resumeTask(task.id);
                } else {
                  setRetryConfirmationOpen(true);
                }
              }}
              type="button"
            >
              <RotateCcw size={16} /> {resumable ? '继续转录' : '载入原配置'}
            </button>
          )}
          {task.outputAvailability !== 'missing' && (task.outputs?.length ?? 0) > 0 && (
            <button
              className="secondary-button"
              onClick={() => void revealTaskOutput(task.id)}
              type="button"
            >
              <FolderOpen size={16} /> 定位输出
            </button>
          )}
        </footer>
      </aside>
      <ConfirmDialog
        confirmLabel="载入原配置"
        description="软件只会把历史输入、参数、模型、硬件和输出策略载入转录工作台，不会立即创建或执行任务。"
        onCancel={closeRetryConfirmation}
        onConfirm={() => void confirmRetry()}
        open={retryConfirmationOpen}
        pending={startingTask}
        title="载入历史转录配置？"
      >
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
            <dt>识别策略</dt>
            <dd>{recognitionStrategyLabel(task.recognitionStrategy)}</dd>
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
            <dt>硬件配置</dt>
            <dd>{formatResolvedHardware(task.hardware)}</dd>
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
      </ConfirmDialog>
    </div>
  );
}

function countHotwords(value: string): number {
  return value
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean).length;
}

function formatDiagnosticRange(start: number | null, end: number | null): string {
  if (start === null && end === null) return '时间未知';
  return `${formatDiagnosticTime(start)}–${formatDiagnosticTime(end)}`;
}

function formatDiagnosticTime(value: number | null): string {
  if (value === null) return '??:??';
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function formatDiagnosticNumber(value: number | null): string {
  return value === null ? '—' : value.toFixed(3);
}

function formatProbabilityChange(before: number | null, after: number | null): string {
  return `${formatDiagnosticNumber(before)} → ${formatDiagnosticNumber(after)}`;
}

function recognitionStrategyLabel(
  strategy: import('../contracts/desktop').RecognitionStrategy | undefined,
): string {
  if (strategy === 'mixed_zh_en') return '复杂中英混合';
  if (strategy === 'zh_detail_review') return '中文细节增强';
  return '稳定主语言';
}

function qualityReasonLabel(
  reason: import('../contracts/desktop').QualityDiagnosticReason,
): string {
  const labels = {
    fallback_temperature: '发生温度回退',
    low_log_probability: '低平均概率',
    high_compression_ratio: '高重复压缩率',
    silence_conflict: '语音/静音判断冲突',
  };
  return labels[reason];
}

function languageDecisionLabel(
  decision: import('../contracts/desktop').LanguageRegionDiagnostic['decision'],
): string {
  const labels = {
    primary: '保留第一遍',
    replaced: '已自动采用',
    review: '保留原文并建议复核',
    rejected: '候选被拒绝',
  };
  return labels[decision];
}

function languageRegionReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    empty_candidate: '英文候选为空',
    insufficient_latin_words: '有效拉丁词不足',
    unsafe_quality: '质量指标触发安全限制',
    invalid_timeline: '候选时间轴异常',
    candidate_outside_region: '候选超出侦测区间',
    no_aligned_primary_segment: '无法与第一遍片段安全对齐',
    unsafe_boundary: '片段边界无法安全衔接',
    implausible_speech_rate: '候选语速异常，未自动采用',
    low_candidate_confidence: '候选解码置信度不足',
    duplicate_candidate: '候选与相邻区间高度重复',
  };
  return labels[reason] ?? reason;
}

function detailDecisionLabel(
  decision: import('../contracts/desktop').DetailCandidateDiagnostic['decision'],
): string {
  const labels = {
    unchanged: '内容一致',
    replaced: '已自动采用',
    review: '保留原文并建议复核',
    rejected: '候选被拒绝',
  };
  return labels[decision];
}

function detailCandidateReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    identical_text: '候选与第一遍一致',
    empty_candidate: '中文候选为空',
    missing_chinese_text: '候选没有有效中文内容',
    empty_primary_alignment: '无法提取可比较的第一遍词级内容',
    unsafe_quality: '质量指标触发安全限制',
    invalid_timeline: '候选时间轴异常',
    candidate_outside_region: '候选超出安全时间边界',
    unsafe_boundary: '正文拼接边界不足以安全自动替换',
    unsafe_length_change: '候选长度变化超出安全范围',
    implausible_speech_rate: '候选字符速率异常',
    protected_content_changed: '数字、拉丁专名或已有正确术语发生变化',
    confidence_improved: '词概率与平均 log probability 均显著提高',
    hotword_recovered: '高置信度恢复任务术语',
    insufficient_probability_gain: '候选结构有效，但置信度提升不足',
  };
  return labels[reason] ?? reason;
}

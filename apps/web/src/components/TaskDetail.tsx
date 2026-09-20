import { FileText, FolderOpen, RotateCcw, X } from 'lucide-react';
import { useRef, useState } from 'react';

import type { TaskSnapshot } from '../contracts/desktop';
import { getModelLabel } from '../data/models';
import { getPreset, transcriptionTaskLabel } from '../data/presets';
import { formatResolvedHardware } from '../state/hardware';
import {
  formatDurationSummary,
  formatMediaDuration,
  taskDurationSummary,
} from '../state/mediaDuration';
import { formatTaskCreatedAt, taskStatusLabel, taskStatusTone } from '../state/taskHistory';
import { formatTaskStage } from '../state/taskStage';
import { canResumeTask, useWorkspace } from '../state/workspace';
import { taskOutputPaths } from '../state/workspaceTaskState';
import { TaskRestoreDialog } from './tasks/TaskRestoreDialog';
import { useDialogFocus } from './useDialogFocus';
import { Button, IconButton } from './Button';

export function TaskDetail() {
  const task = useWorkspace((state) =>
    state.tasks.find((item) => item.id === state.selectedTaskId),
  );
  return task ? <TaskDetailContent key={task.id} task={task} /> : null;
}

function TaskDetailContent({ task }: { task: TaskSnapshot }) {
  const preview = useWorkspace((state) => state.outputPreview);
  const previewLoading = useWorkspace((state) => state.previewLoading);
  const selectTask = useWorkspace((state) => state.selectTask);
  const resumeTask = useWorkspace((state) => state.resumeTask);
  const revealTaskOutput = useWorkspace((state) => state.revealTaskOutput);
  const [restoreTask, setRestoreTask] = useState<TaskSnapshot | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(true, detailRef, closeRef, () => void selectTask(null));
  const outputs = taskOutputPaths(task);
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
        ref={detailRef}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <p className="step-label">TASK SNAPSHOT</p>
            <h2 id="task-detail-title">{task.title}</h2>
          </div>
          <IconButton
            label="关闭任务详情"
            ref={closeRef}
            onClick={() => void selectTask(null)}
            type="button"
          >
            <X size={18} />
          </IconButton>
        </header>

        <div className="detail-status-line">
          <span className={`status-badge ${taskStatusTone(task)}`}>{taskStatusLabel(task)}</span>
          <span>{task.progress}%</span>
          <span>
            {task.outputAvailability === 'missing'
              ? '输出文件已丢失或移动'
              : formatTaskStage(task.stage)}
          </span>
        </div>

        <dl className="detail-facts" aria-label="任务概要">
          {[
            [
              '转录模式',
              `${getPreset(task.presetId).label} · ${transcriptionTaskLabel(task.draft?.effectiveParameters.task)}`,
            ],
            ['模型', getModelLabel(task.modelId)],
            ['执行硬件', formatResolvedHardware(task.hardware)],
            ['创建时间', formatTaskCreatedAt(task.createdAt)],
            ['处理耗时', task.elapsed],
            ['媒体时长', formatDurationSummary(taskDurationSummary(task))],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

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
                : input.durationSeconds === undefined
                  ? '时长未知'
                  : `时长 ${formatMediaDuration(input.durationSeconds)}`}
            </code>
          )) ?? <span>旧任务没有保存输入快照。</span>}
        </section>

        {outputs.length > 0 && (
          <section className="detail-section">
            <h3>输出文件</h3>
            {outputs.map((output) => (
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
                    <span>{diagnostics.secondaryPassCount ?? 0} 次局部复识别</span>
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

        <footer>
          {task.draft && task.status !== 'running' && task.status !== 'queued' && (
            <Button
              onClick={() => {
                if (resumable) {
                  void resumeTask(task.id);
                } else {
                  setRestoreTask(task);
                }
              }}
              type="button"
            >
              <RotateCcw size={16} /> {resumable ? '继续转录' : '载入原配置'}
            </Button>
          )}
          {task.outputAvailability !== 'missing' && outputs.length > 0 && (
            <Button onClick={() => void revealTaskOutput(task.id)} type="button">
              <FolderOpen size={16} /> 定位输出
            </Button>
          )}
        </footer>
      </aside>
      <TaskRestoreDialog task={restoreTask} onClose={() => setRestoreTask(null)} />
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

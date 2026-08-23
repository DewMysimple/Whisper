import type {
  HardwarePreference,
  ModelId,
  OutputPolicy,
  TaskSnapshot,
  TranscriptionDraft,
  WorkerEnvironment,
} from '../contracts/desktop';
import { MODEL_IDS } from '../contracts/desktop';

export interface PendingTaskMetadata {
  title: string;
  sourceCount: number;
  presetId: TranscriptionDraft['basePresetId'];
  isCustom: boolean;
  createdAt: string;
  draft: TranscriptionDraft;
}

export const STAGE_LABELS: Record<string, string> = {
  'input.validating': '校验输入',
  'input.discovering': '展开媒体文件',
  'model.loading': '准备本地模型',
  'transcription.running': 'GPU 转录中',
  'postprocess.running': '文本后处理',
  'output.writing': '写入输出',
  'task.finalizing': '汇总任务结果',
};

export const ERROR_LABELS: Record<string, string> = {
  'request.invalid': '任务配置无效',
  'task.not_found': '任务不存在或已经结束',
  'task.conflict': '任务或输出目标冲突',
  'worker.busy': '推理 Worker 正忙',
  'worker.internal': '推理 Worker 内部错误',
  'environment.unavailable': '本地推理环境不可用',
  'model.load_failed': '本地模型加载失败',
  'transcription.failed': '转录失败',
  'output.failed': '输出规划或写入失败',
  'host.worker_not_ready': '桌面推理 Worker 尚未就绪',
  'host.worker_disconnected': '桌面推理 Worker 已断开',
  'host.protocol_invalid': 'Worker 返回了无效协议消息',
};

export function normalizeDialogPaths(value: string | string[] | null): string[] {
  if (value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function createRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? `${Date.now()}`;
  return `desktop-${random}`;
}

export function isModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && MODEL_IDS.includes(value as ModelId);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createTaskMetadata(draft: TranscriptionDraft): PendingTaskMetadata {
  const title =
    draft.inputs.length === 1
      ? (draft.inputs[0]?.path.split(/[/\\]/).at(-1) ?? '本地转录任务')
      : `${draft.inputs.length} 个输入来源`;
  return {
    title,
    sourceCount: draft.inputs.length,
    presetId: draft.basePresetId,
    isCustom: Object.keys(draft.overrides).length > 0,
    createdAt: currentTimestamp(),
    draft: structuredClone(draft),
  };
}

export function toHostHardware(hardware: HardwarePreference | undefined) {
  if (hardware === undefined) return undefined;
  return {
    mode: hardware.mode,
    gpuDeviceIndex: hardware.gpuDeviceIndex,
    cudaComputeType: hardware.cudaComputeType,
    cpuComputeType: hardware.cpuComputeType,
    cpuThreads: hardware.cpuThreads,
  };
}

export function toHostOutput(
  output: OutputPolicy,
  subtitle: TranscriptionDraft['subtitleParameters'],
  allowOverwrite = false,
  skipConflicts = false,
) {
  return {
    mode: output.mode,
    rootDirectory: output.mode === 'custom' ? output.rootDirectory : null,
    txtEnabled: output.txtEnabled,
    markdownEnabled: output.markdownEnabled,
    srtEnabled: output.srtEnabled,
    preserveSourceTxt: output.preserveSourceTxt,
    preserveSourceMarkdown: output.preserveSourceMarkdown,
    conflictPolicy:
      output.conflictPolicy === 'auto_rename'
        ? 'auto_rename'
        : skipConflicts
          ? 'skip'
          : allowOverwrite
            ? 'overwrite'
            : 'fail',
    subtitle: {
      maxCharactersPerLine: subtitle.max_characters_per_line,
      maxLinesPerCue: subtitle.max_lines_per_cue,
      minCueDurationMs: subtitle.min_cue_duration_ms,
      maxCueDurationMs: subtitle.max_cue_duration_ms,
      maxCharactersPerSecond: subtitle.max_characters_per_second,
      cueGapMs: subtitle.cue_gap_ms,
    },
  };
}

export function currentTimestamp(): string {
  return new Date().toISOString();
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

export function readNullableNumberArray(value: unknown): Array<number | null> {
  if (!Array.isArray(value)) return [];
  return value.map((item) =>
    item === null || (typeof item === 'number' && Number.isFinite(item) && item >= 0) ? item : null,
  );
}

export function readConflictGroups(value: unknown): Array<{ inputPath: string; paths: string[] }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.input_path !== 'string') return [];
    return [{ inputPath: item.input_path, paths: readStringArray(item.paths) }];
  });
}

export function readTaskMediaStatus(
  value: unknown,
): 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | undefined {
  return ['pending', 'running', 'completed', 'failed', 'skipped'].includes(String(value))
    ? (value as 'pending' | 'running' | 'completed' | 'failed' | 'skipped')
    : undefined;
}

export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readResolvedHardware(value: unknown): TaskSnapshot['hardware'] {
  if (!isRecord(value)) return undefined;
  const device = value.device;
  const deviceIndex = readNumber(value.device_index);
  const computeType = readString(value.compute_type);
  const cpuThreads = readNumber(value.cpu_threads);
  if (
    (device !== 'cuda' && device !== 'cpu') ||
    deviceIndex === null ||
    computeType === null ||
    cpuThreads === null
  ) {
    return undefined;
  }
  return { device, deviceIndex, computeType, cpuThreads };
}

export function isWorkerEnvironment(value: unknown): value is WorkerEnvironment {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.available === 'boolean' &&
    Array.isArray(candidate.errors) &&
    candidate.errors.every((item) => typeof item === 'string') &&
    typeof candidate.python === 'string' &&
    typeof candidate.platform === 'string' &&
    (candidate.hardware === undefined ||
      candidate.hardware === null ||
      readHardwareCapabilities(candidate.hardware) !== undefined)
  );
}

export function readHardwareCapabilities(value: unknown): WorkerEnvironment['hardware'] {
  if (!isRecord(value)) return undefined;
  if (
    (value.cpu_name !== null && typeof value.cpu_name !== 'string') ||
    typeof value.cpu_physical_cores !== 'number' ||
    typeof value.cpu_logical_cores !== 'number' ||
    !Array.isArray(value.cpu_compute_types) ||
    !Array.isArray(value.gpus)
  ) {
    return undefined;
  }
  if (!(
    value.cpu_compute_types.every((item) => typeof item === 'string') &&
    value.gpus.every(
      (item) =>
        isRecord(item) &&
        typeof item.index === 'number' &&
        typeof item.name === 'string' &&
        Array.isArray(item.compute_types) &&
        item.compute_types.every((type) => typeof type === 'string'),
    )
  ))
    return undefined;
  return {
    cpuName: value.cpu_name as string | null,
    cpuPhysicalCores: value.cpu_physical_cores as number,
    cpuLogicalCores: value.cpu_logical_cores as number,
    cpuComputeTypes: value.cpu_compute_types as string[],
    gpus: (value.gpus as Array<Record<string, unknown>>).map((item) => ({
      index: item.index as number,
      name: item.name as string,
      computeTypes: item.compute_types as string[],
    })),
  };
}

export interface PerformanceResult {
  timestamp_ms: number;
  cpu_percent: number;
  memory_percent: number;
  memory_used_gib: number;
  memory_total_gib: number;
  gpu_percent: number | null;
  vram_used_gib: number | null;
  vram_total_gib: number | null;
  gpu_name: string | null;
  memory_available_gib?: number | null;
  swap_used_gib?: number | null;
  swap_total_gib?: number | null;
  worker_rss_gib?: number | null;
  worker_thread_count?: number | null;
  worker_handle_count?: number | null;
  cpu_name?: string | null;
  cpu_frequency_mhz?: number | null;
  cpu_physical_cores?: number | null;
  cpu_logical_cores?: number | null;
  system_process_count?: number | null;
  system_uptime_seconds?: number | null;
  gpu_memory_controller_percent?: number | null;
  gpu_temperature_c?: number | null;
  gpu_clock_mhz?: number | null;
  gpu_memory_clock_mhz?: number | null;
  gpu_power_watts?: number | null;
  gpu_power_limit_watts?: number | null;
  gpu_fan_percent?: number | null;
  gpu_driver_version?: string | null;
  gpu_performance_state?: string | null;
}

export function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

export function readRecognitionQualityDiagnostics(
  value: unknown,
): import('../contracts/desktop').RecognitionQualityDiagnostics | undefined {
  if (!isRecord(value) || !Array.isArray(value.segments)) return undefined;
  const detectedLanguage =
    value.detected_language === null
      ? null
      : typeof value.detected_language === 'string'
        ? value.detected_language
        : undefined;
  const languageProbability = isNullableNumber(value.language_probability)
    ? value.language_probability
    : undefined;
  const segmentCount = readNumber(value.segment_count);
  const fallbackSegmentCount = readNumber(value.fallback_segment_count);
  const maxTemperature = readNumber(value.max_temperature);
  const lowConfidenceCount = readNumber(value.low_confidence_count);
  if (
    detectedLanguage === undefined ||
    languageProbability === undefined ||
    segmentCount === null ||
    fallbackSegmentCount === null ||
    maxTemperature === null ||
    lowConfidenceCount === null
  ) {
    return undefined;
  }
  const allowedReasons = new Set([
    'fallback_temperature',
    'low_log_probability',
    'high_compression_ratio',
    'silence_conflict',
  ]);
  const segments = value.segments.flatMap((item) => {
    if (!isRecord(item) || !Array.isArray(item.reasons) || typeof item.text !== 'string') return [];
    const index = readNumber(item.index);
    if (
      index === null ||
      !isNullableNumber(item.start) ||
      !isNullableNumber(item.end) ||
      !isNullableNumber(item.temperature) ||
      !isNullableNumber(item.avg_logprob) ||
      !isNullableNumber(item.compression_ratio) ||
      !isNullableNumber(item.no_speech_prob) ||
      !item.reasons.every(
        (reason): reason is import('../contracts/desktop').QualityDiagnosticReason =>
          typeof reason === 'string' && allowedReasons.has(reason),
      )
    ) {
      return [];
    }
    return [
      {
        index,
        start: item.start,
        end: item.end,
        text: item.text,
        temperature: item.temperature,
        avgLogProbability: item.avg_logprob,
        compressionRatio: item.compression_ratio,
        noSpeechProbability: item.no_speech_prob,
        reasons: item.reasons,
      },
    ];
  });
  if (segments.length !== lowConfidenceCount) return undefined;
  const recognitionStrategy = isRecognitionStrategy(value.recognition_strategy)
    ? value.recognition_strategy
    : undefined;
  const languageRegions = readLanguageRegions(value.language_regions);
  const detailCandidates = readDetailCandidates(value.detail_candidates);
  const hotwordAudit = readHotwordAudit(value.hotword_audit);
  return {
    detectedLanguage,
    languageProbability,
    segmentCount,
    fallbackSegmentCount,
    maxTemperature,
    lowConfidenceCount,
    segments,
    ...(recognitionStrategy ? { recognitionStrategy } : {}),
    ...(languageRegions ? { languageRegions } : {}),
    ...(detailCandidates ? { detailCandidates } : {}),
    ...(readNumber(value.secondary_pass_count) !== null
      ? { secondaryPassCount: readNumber(value.secondary_pass_count)! }
      : {}),
    ...(readNumber(value.replaced_region_count) !== null
      ? { replacedRegionCount: readNumber(value.replaced_region_count)! }
      : {}),
    ...(readNumber(value.review_region_count) !== null
      ? { reviewRegionCount: readNumber(value.review_region_count)! }
      : {}),
    ...(readNumber(value.rejected_region_count) !== null
      ? { rejectedRegionCount: readNumber(value.rejected_region_count)! }
      : {}),
    ...(hotwordAudit ? { hotwordAudit } : {}),
  };
}

export function readDetailCandidates(
  value: unknown,
): import('../contracts/desktop').DetailCandidateDiagnostic[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const candidates = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const start = readNumber(item.start);
    const end = readNumber(item.end);
    const chineseProbability = readNumber(item.chinese_probability);
    const validDecision = ['unchanged', 'replaced', 'review', 'rejected'].includes(
      String(item.decision),
    );
    if (
      start === null ||
      end === null ||
      end <= start ||
      chineseProbability === null ||
      chineseProbability < 0 ||
      chineseProbability > 1 ||
      typeof item.primary_text !== 'string' ||
      typeof item.candidate_text !== 'string' ||
      !validDecision ||
      (item.reason !== null && typeof item.reason !== 'string') ||
      !isNullableNumber(item.primary_word_probability) ||
      !isNullableNumber(item.candidate_word_probability) ||
      !isNullableNumber(item.primary_log_probability) ||
      !isNullableNumber(item.candidate_log_probability) ||
      !Array.isArray(item.recovered_hotwords) ||
      !item.recovered_hotwords.every((term) => typeof term === 'string' && term.length > 0)
    ) {
      return [];
    }
    return [
      {
        start,
        end,
        chineseProbability,
        primaryText: item.primary_text,
        candidateText: item.candidate_text,
        decision: item.decision as 'unchanged' | 'replaced' | 'review' | 'rejected',
        reason: item.reason,
        primaryWordProbability: item.primary_word_probability,
        candidateWordProbability: item.candidate_word_probability,
        primaryLogProbability: item.primary_log_probability,
        candidateLogProbability: item.candidate_log_probability,
        recoveredHotwords: item.recovered_hotwords,
      },
    ];
  });
  return candidates.length === value.length ? candidates : undefined;
}

export function readLanguageRegions(
  value: unknown,
): import('../contracts/desktop').LanguageRegionDiagnostic[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const regions = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const start = readNumber(item.start);
    const end = readNumber(item.end);
    const topProbability = readNumber(item.top_probability);
    const englishProbability = readNumber(item.english_probability);
    const chineseProbability = readNumber(item.chinese_probability);
    if (
      start === null ||
      end === null ||
      topProbability === null ||
      englishProbability === null ||
      chineseProbability === null ||
      typeof item.top_language !== 'string' ||
      typeof item.primary_text !== 'string' ||
      typeof item.candidate_text !== 'string' ||
      !['primary', 'replaced', 'review', 'rejected'].includes(String(item.decision)) ||
      (item.reason !== null && typeof item.reason !== 'string')
    ) {
      return [];
    }
    return [
      {
        start,
        end,
        topLanguage: item.top_language,
        topProbability,
        englishProbability,
        chineseProbability,
        primaryText: item.primary_text,
        candidateText: item.candidate_text,
        decision: item.decision as 'primary' | 'replaced' | 'review' | 'rejected',
        reason: item.reason,
      },
    ];
  });
  return regions.length === value.length ? regions : undefined;
}

export function readHotwordAudit(
  value: unknown,
): import('../contracts/desktop').HotwordAudit | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const termCount = readNumber(value.term_count);
  const matchedCount = readNumber(value.matched_count);
  const missingCount = readNumber(value.missing_count);
  const omittedTermCount = readNumber(value.omitted_term_count);
  const matchedTerms = readStringArray(value.matched_terms);
  const missingTerms = readStringArray(value.missing_terms);
  if (
    termCount === null ||
    matchedCount === null ||
    missingCount === null ||
    omittedTermCount === null
  ) {
    return undefined;
  }
  return {
    termCount,
    matchedCount,
    missingCount,
    omittedTermCount,
    matchedTerms,
    missingTerms,
  };
}

export function isRecognitionStrategy(
  value: unknown,
): value is import('../contracts/desktop').RecognitionStrategy {
  return value === 'stable_primary' || value === 'mixed_zh_en' || value === 'zh_detail_review';
}

export function isPerformanceResult(value: unknown): value is PerformanceResult {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  const optionalNumbers = [
    'memory_available_gib',
    'swap_used_gib',
    'swap_total_gib',
    'worker_rss_gib',
    'worker_thread_count',
    'worker_handle_count',
    'cpu_frequency_mhz',
    'cpu_physical_cores',
    'cpu_logical_cores',
    'system_process_count',
    'system_uptime_seconds',
    'gpu_memory_controller_percent',
    'gpu_temperature_c',
    'gpu_clock_mhz',
    'gpu_memory_clock_mhz',
    'gpu_power_watts',
    'gpu_power_limit_watts',
    'gpu_fan_percent',
  ];
  const optionalStrings = ['cpu_name', 'gpu_driver_version', 'gpu_performance_state'];
  return (
    typeof item.timestamp_ms === 'number' &&
    typeof item.cpu_percent === 'number' &&
    typeof item.memory_percent === 'number' &&
    typeof item.memory_used_gib === 'number' &&
    typeof item.memory_total_gib === 'number' &&
    isNullableNumber(item.gpu_percent) &&
    isNullableNumber(item.vram_used_gib) &&
    isNullableNumber(item.vram_total_gib) &&
    (item.gpu_name === null || typeof item.gpu_name === 'string') &&
    optionalNumbers.every((key) => item[key] === undefined || isNullableNumber(item[key])) &&
    optionalStrings.every(
      (key) => item[key] === undefined || item[key] === null || typeof item[key] === 'string',
    )
  );
}

export function outputConflictDetails(data: unknown): {
  paths: string[];
  conflicts: Array<{ inputPath: string; paths: string[] }>;
  mediaPaths: string[];
} | null {
  if (!isRecord(data) || data.exception !== 'OutputConflictError' || !Array.isArray(data.paths)) {
    return null;
  }
  const paths = data.paths.filter((item): item is string => typeof item === 'string');
  if (paths.length === 0) return null;
  const conflicts = Array.isArray(data.conflicts)
    ? data.conflicts.flatMap((item) => {
        if (!isRecord(item) || typeof item.input_path !== 'string' || !Array.isArray(item.paths)) {
          return [];
        }
        return [
          {
            inputPath: item.input_path,
            paths: item.paths.filter((path): path is string => typeof path === 'string'),
          },
        ];
      })
    : [];
  const mediaPaths = Array.isArray(data.media_paths)
    ? data.media_paths.filter((item): item is string => typeof item === 'string')
    : [];
  return { paths, conflicts, mediaPaths };
}

export function normalizeInvokeError(error: unknown): Error & { code: string; data?: unknown } {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>;
    const code = typeof candidate.code === 'string' ? candidate.code : 'host.command_failed';
    const message =
      typeof candidate.message === 'string'
        ? candidate.message
        : (ERROR_LABELS[code] ?? '桌面命令执行失败');
    return Object.assign(new Error(message), { code, data: candidate.data });
  }
  return Object.assign(new Error(String(error)), { code: 'host.command_failed' });
}

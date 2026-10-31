import { expect, it } from 'vitest';
import qwenProgress from '../../../../tests/fixtures/qwen_quality_progress.json';
import { supportsDecodingDiagnostics } from '../data/models';
import { readRecognitionQualityDiagnostics } from './tauriWorkerDecoder';

it('decodes the shared v1 Qwen language/term carrier without declaring decode capability', () => {
  const diagnostics = readRecognitionQualityDiagnostics(qwenProgress.data.quality_diagnostics);
  expect(diagnostics).toMatchObject({
    detectedLanguage: 'zh',
    languageProbability: null,
    segmentCount: 1,
    hotwordAudit: { matchedTerms: ['拟态'], missingTerms: ['李普曼'] },
  });
  expect(supportsDecodingDiagnostics('qwen3-asr-0.6b')).toBe(false);
  expect(supportsDecodingDiagnostics('qwen3-asr-1.7b')).toBe(false);
  expect(supportsDecodingDiagnostics('large-v3-turbo')).toBe(true);
});

it('keeps absent old/pending diagnostics absent', () => {
  expect(readRecognitionQualityDiagnostics(undefined)).toBeUndefined();
});

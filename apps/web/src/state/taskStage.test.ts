import { describe, expect, it } from 'vitest';

import { formatTaskStage } from './taskStage';

describe('task stage presentation', () => {
  it('removes retired GPU wording from legacy task snapshots', () => {
    expect(formatTaskStage('GPU 转录中')).toBe('转录中');
    expect(formatTaskStage('等待本地 GPU')).toBe('等待执行');
  });

  it('preserves current stage labels', () => {
    expect(formatTaskStage('文本后处理')).toBe('文本后处理');
  });
});

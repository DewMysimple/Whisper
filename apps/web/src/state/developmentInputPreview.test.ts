import { describe, expect, it } from 'vitest';

import type { InputSource } from '../contracts/desktop';
import {
  createDevelopmentInputPreview,
  DEVELOPMENT_INPUT_PREVIEW_ID,
} from './developmentInputPreview';

describe('development input preview', () => {
  it('expands mock directories into individual pending media rows', () => {
    const inputs: InputSource[] = [
      {
        id: 'file-1',
        path: 'C:\\Media\\lesson.wav',
        kind: 'file',
        origin: 'dialog',
        valid: true,
        durationSeconds: 90,
      },
      {
        id: 'directory-1',
        path: 'D:\\Recordings\\Sprint',
        kind: 'directory',
        origin: 'dialog',
        valid: true,
        mediaCount: 3,
        durationSeconds: 600,
      },
    ];

    const preview = createDevelopmentInputPreview(inputs, 'cn2', 'large-v3-turbo');

    expect(preview).toMatchObject({
      id: DEVELOPMENT_INPUT_PREVIEW_ID,
      title: '4 个待处理媒体',
      sourceCount: 4,
      status: 'queued',
      progress: 0,
      stage: '等待开始',
      processingCount: 4,
    });
    expect(preview?.mediaStates?.map((media) => media.path)).toEqual([
      'C:\\Media\\lesson.wav',
      'D:\\Recordings\\Sprint\\Sprint-01.mp4',
      'D:\\Recordings\\Sprint\\Sprint-02.mp4',
      'D:\\Recordings\\Sprint\\Sprint-03.mp4',
    ]);
    expect(preview?.mediaStates?.every((media) => media.status === 'pending')).toBe(true);
    expect(preview?.totalMediaDurationSeconds).toBe(690);
  });

  it('leaves the previous task monitor untouched when no new inputs exist', () => {
    expect(createDevelopmentInputPreview([], 'en_v1', 'large-v3-turbo')).toBeNull();
  });
});

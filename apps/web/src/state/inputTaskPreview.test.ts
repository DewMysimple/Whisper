import { describe, expect, it } from 'vitest';

import type { InputSource } from '../contracts/desktop';
import { createInputTaskPreview, INPUT_TASK_PREVIEW_ID } from './inputTaskPreview';

describe('input task preview', () => {
  it('keeps directory summaries without inventing child paths or dividing their durations', () => {
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

    const preview = createInputTaskPreview(inputs, 'cn2', 'large-v3-turbo');

    expect(preview).toMatchObject({
      id: INPUT_TASK_PREVIEW_ID,
      title: '4 个待处理媒体',
      sourceCount: 4,
      status: 'queued',
      progress: 0,
      stage: '等待开始',
      processingCount: 4,
    });
    expect(preview?.mediaStates?.map((media) => media.path)).toEqual([
      'C:\\Media\\lesson.wav',
      'D:\\Recordings\\Sprint',
    ]);
    expect(preview?.mediaStates?.every((media) => media.status === 'pending')).toBe(true);
    expect(preview?.totalMediaDurationSeconds).toBe(690);
    expect(preview?.mediaStates?.[1]?.durationSeconds).toBe(600);
  });

  it('preserves unknown durations and empty-directory counts', () => {
    const preview = createInputTaskPreview(
      [
        {
          id: 'partial',
          path: 'D:\\partial',
          kind: 'directory',
          origin: 'dialog',
          valid: true,
          mediaCount: 3,
          durationSeconds: 90,
          unknownDurationCount: 2,
        },
        {
          id: 'empty',
          path: 'D:\\empty',
          kind: 'directory',
          origin: 'dialog',
          valid: false,
          mediaCount: 0,
        },
      ],
      'cn2',
      'large-v3-turbo',
    );
    expect(preview).toMatchObject({
      sourceCount: 3,
      totalMediaDurationSeconds: 90,
      unknownMediaDurationCount: 2,
    });
    expect(preview?.mediaStates).toHaveLength(2);
  });

  it('leaves the previous task monitor untouched when no new inputs exist', () => {
    expect(createInputTaskPreview([], 'en_v1', 'large-v3-turbo')).toBeNull();
  });
});

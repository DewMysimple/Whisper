import { describe, expect, it } from 'vitest';

import { parseWindowsClipboardPaths } from './clipboardPaths';

describe('parseWindowsClipboardPaths', () => {
  it('preserves spaces in one unquoted Windows path', () => {
    expect(parseWindowsClipboardPaths('C:\\Media Files\\lesson one.mp4')).toEqual([
      'C:\\Media Files\\lesson one.mp4',
    ]);
  });

  it('reads Explorer quoted paths from multiple lines or one line', () => {
    expect(
      parseWindowsClipboardPaths('"C:\\Media\\lesson one.mp4"\r\n"D:\\Archive\\lesson two.wav"'),
    ).toEqual(['C:\\Media\\lesson one.mp4', 'D:\\Archive\\lesson two.wav']);
    expect(
      parseWindowsClipboardPaths('"C:\\Media\\lesson one.mp4" "D:\\Archive\\lesson two.wav"'),
    ).toEqual(['C:\\Media\\lesson one.mp4', 'D:\\Archive\\lesson two.wav']);
  });

  it('supports UNC paths and removes case-insensitive duplicates', () => {
    expect(
      parseWindowsClipboardPaths(
        '\\\\server\\share\\lesson.mp4\r\nC:\\Media\\LESSON.mp4\r\nc:\\media\\lesson.mp4',
      ),
    ).toEqual(['\\\\server\\share\\lesson.mp4', 'C:\\Media\\LESSON.mp4']);
  });

  it('does not treat arbitrary clipboard text as a path', () => {
    expect(parseWindowsClipboardPaths('这不是文件路径')).toEqual([]);
  });
});

import type { TaskSnapshot } from '../contracts/desktop';

function fileName(path: string): string {
  return path.split(/[/\\]/).at(-1) ?? path;
}

export function taskSourceSummary(task: TaskSnapshot): string | null {
  const inputs = task.draft?.inputs ?? [];
  if (inputs.length === 0) return null;
  const mediaCount = task.sourceCount;

  if (inputs.length === 1) {
    const input = inputs[0]!;
    if (input.kind === 'file') return fileName(input.path);
    return `${fileName(input.path)} · ${mediaCount} 个媒体文件`;
  }
  if (inputs.every((input) => input.kind === 'file')) {
    return `多文件路径 · ${mediaCount} 个媒体文件`;
  }
  return `多个输入来源 · ${mediaCount} 个媒体文件`;
}

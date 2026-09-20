import type { TaskSnapshot } from '../contracts/desktop';
import { formatMediaDuration, taskDurationSummary } from './mediaDuration';
import { taskOutputPaths } from './workspaceTaskState';

export type TaskFilter = 'all' | 'active' | 'completed' | 'failed';

export interface TaskDateRange {
  start: string;
  end: string;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

export function taskDateKey(createdAt: string): string | null {
  if (!ISO_TIMESTAMP.test(createdAt)) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatTaskCreatedAt(createdAt: string): string {
  const dateKey = taskDateKey(createdAt);
  if (dateKey === null) return `日期未知 · ${createdAt}`;
  const date = new Date(createdAt);
  return `${dateKey} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function availableTaskDates(tasks: TaskSnapshot[]): string[] {
  return [
    ...new Set(
      tasks
        .map((task) => taskDateKey(task.createdAt))
        .filter((date): date is string => date !== null),
    ),
  ].sort();
}

export function normalizeTaskDateRange(first: string, second: string): TaskDateRange {
  return first <= second ? { start: first, end: second } : { start: second, end: first };
}

export function taskMatchesDateRange(task: TaskSnapshot, range: TaskDateRange | null): boolean {
  if (range === null) return true;
  const date = taskDateKey(task.createdAt);
  return date !== null && date >= range.start && date <= range.end;
}

export function taskStatusLabel(task: TaskSnapshot): string {
  if (task.outputAvailability === 'missing') return '输出缺失';
  if (task.status === 'running') return '运行中';
  if (task.status === 'completed') return '已完成';
  if (task.status === 'cancelled') return '已取消';
  if (task.status === 'failed') return '失败';
  return '等待中';
}
export function taskStatusTone(task: TaskSnapshot): string {
  return task.outputAvailability === 'missing' ? 'failed' : task.status;
}
export function taskMatchesFilter(task: TaskSnapshot, filter: TaskFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return task.status === 'queued' || task.status === 'running';
  if (filter === 'completed') {
    return task.status === 'completed' && task.outputAvailability !== 'missing';
  }
  return task.status === 'failed';
}

/** Filters and counts share predicates so the cards cannot disagree with the list. */
export function taskHistoryCounts(tasks: TaskSnapshot[]): Record<TaskFilter, number> {
  return {
    all: tasks.length,
    active: tasks.filter((task) => taskMatchesFilter(task, 'active')).length,
    completed: tasks.filter((task) => taskMatchesFilter(task, 'completed')).length,
    failed: tasks.filter((task) => taskMatchesFilter(task, 'failed')).length,
  };
}
export function taskOutputFormats(task: TaskSnapshot): string[] {
  const formats: string[] = [];
  const output = task.draft?.output;
  if (output?.txtEnabled) formats.push('TXT');
  if (output?.markdownEnabled) formats.push('MD');
  if (output?.srtEnabled) formats.push('SRT');
  if (formats.length === 0) {
    for (const path of taskOutputPaths(task)) {
      const extension = path.split('.').at(-1)?.toLocaleLowerCase();
      const label = extension === 'markdown' ? 'MD' : extension?.toLocaleUpperCase();
      if (label && ['TXT', 'MD', 'SRT'].includes(label) && !formats.includes(label)) {
        formats.push(label);
      }
    }
  }
  return formats.length > 0 ? formats : ['格式未记录'];
}
export function taskTitleParts(title: string): {
  basename: string;
  extension: string;
} | null {
  const extensionStart = title.lastIndexOf('.');
  if (extensionStart <= 0 || extensionStart === title.length - 1) return null;
  return {
    basename: title.slice(0, extensionStart).trimEnd(),
    extension: title.slice(extensionStart),
  };
}
export function taskDurationValue(task: TaskSnapshot): string {
  const summary = taskDurationSummary(task);
  if (summary.unknownCount > 0) {
    if (summary.knownSeconds > 0) {
      return `${formatMediaDuration(summary.knownSeconds)} + ${summary.unknownCount} 未知`;
    }
    return summary.unknownCount >= task.sourceCount ? '未知' : `${summary.unknownCount} 个未知`;
  }
  return formatMediaDuration(summary.knownSeconds);
}

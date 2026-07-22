import type { TaskSnapshot } from '../contracts/desktop';

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

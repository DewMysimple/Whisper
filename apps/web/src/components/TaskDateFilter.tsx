import { CalendarRange, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { TaskDateRange } from '../state/taskHistory';
import { normalizeTaskDateRange } from '../state/taskHistory';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const;

function monthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthParts(value: string): { year: number; month: number } {
  const [year, month] = value.split('-').map(Number);
  return { year: year!, month: month! - 1 };
}

function shiftMonth(value: string, delta: number): string {
  const { year, month } = monthParts(value);
  const shifted = new Date(year, month + delta, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
}

function calendarCells(value: string): Array<string | null> {
  const { year, month } = monthParts(value);
  const leading = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  return [
    ...Array.from<null>({ length: leading }).fill(null),
    ...Array.from({ length: days }, (_, index) => dateKey(year, month, index + 1)),
  ];
}

function rangeLabel(range: TaskDateRange | null): string {
  if (range === null) return '全部日期';
  return range.start === range.end ? range.start : `${range.start} 至 ${range.end}`;
}

interface TaskDateFilterProps {
  availableDates: string[];
  range: TaskDateRange | null;
  onChange(range: TaskDateRange | null): void;
}

export function TaskDateFilter({ availableDates, range, onChange }: TaskDateFilterProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const latestMonth = monthKey(availableDates.at(-1) ?? new Date().toISOString().slice(0, 10));
  const [visibleMonth, setVisibleMonth] = useState(() => monthKey(range?.start ?? latestMonth));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const available = useMemo(() => new Set(availableDates), [availableDates]);
  const cells = useMemo(() => calendarCells(visibleMonth), [visibleMonth]);
  const minimumMonth = monthKey(availableDates[0] ?? latestMonth);
  const maximumMonth = monthKey(availableDates.at(-1) ?? latestMonth);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const selectDate = (selected: string) => {
    if (anchor === null) {
      setAnchor(selected);
      onChange({ start: selected, end: selected });
      return;
    }
    onChange(normalizeTaskDateRange(anchor, selected));
    setAnchor(null);
  };

  return (
    <div className="task-date-filter" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`task-date-trigger ${range ? 'is-active' : ''}`}
        disabled={availableDates.length === 0 && range === null}
        onClick={() => {
          setVisibleMonth(monthKey(range?.start ?? availableDates.at(-1) ?? latestMonth));
          setOpen((value) => !value);
        }}
        ref={triggerRef}
        type="button"
      >
        <CalendarRange size={16} />
        <span>{rangeLabel(range)}</span>
      </button>
      {open && (
        <div aria-label="按任务日期筛选" className="task-calendar-popover" role="dialog">
          <div className="task-calendar-heading">
            <button
              aria-label="上一个月"
              disabled={visibleMonth <= minimumMonth}
              onClick={() => setVisibleMonth((value) => shiftMonth(value, -1))}
              type="button"
            >
              <ChevronLeft size={16} />
            </button>
            <strong>{visibleMonth.replace('-', ' 年 ')} 月</strong>
            <button
              aria-label="下一个月"
              disabled={visibleMonth >= maximumMonth}
              onClick={() => setVisibleMonth((value) => shiftMonth(value, 1))}
              type="button"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="task-calendar-weekdays" aria-hidden="true">
            {WEEKDAYS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div className="task-calendar-grid">
            {cells.map((date, index) =>
              date === null ? (
                <span aria-hidden="true" key={`blank-${index}`} />
              ) : (
                <button
                  aria-label={date}
                  aria-pressed={range !== null && date >= range.start && date <= range.end}
                  className={
                    range !== null && date >= range.start && date <= range.end ? 'is-selected' : ''
                  }
                  disabled={!available.has(date)}
                  key={date}
                  onClick={() => selectDate(date)}
                  type="button"
                >
                  {Number(date.slice(-2))}
                </button>
              ),
            )}
          </div>
          <div className="task-calendar-footer">
            <span>{anchor ? '请选择结束日期' : '仅可选择有任务的日期'}</span>
            <button
              disabled={range === null}
              onClick={() => {
                setAnchor(null);
                onChange(null);
              }}
              type="button"
            >
              <X size={14} /> 全部日期
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

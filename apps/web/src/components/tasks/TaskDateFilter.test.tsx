import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import type { TaskDateRange } from '../../state/taskHistory';
import { TaskDateFilter } from './TaskDateFilter';

function Filter() {
  const [range, setRange] = useState<TaskDateRange | null>(null);
  return (
    <TaskDateFilter
      availableDates={['2026-09-01', '2026-09-19']}
      range={range}
      onChange={setRange}
    />
  );
}

it('starts a new date selection after reopening instead of using a stale range anchor', () => {
  render(<Filter />);
  fireEvent.click(screen.getByRole('button', { name: '全部日期' }));
  fireEvent.click(screen.getByRole('button', { name: '2026-09-01' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '2026-09-01' }));
  fireEvent.click(screen.getByRole('button', { name: '2026-09-19' }));
  expect(document.querySelector('.task-date-trigger')).toHaveTextContent('2026-09-19');
  expect(document.querySelector('.task-date-trigger')).not.toHaveTextContent('至');
});

it('focuses a selectable date and restores focus on Escape', () => {
  render(<Filter />);
  const trigger = screen.getByRole('button', { name: '全部日期' });
  fireEvent.click(trigger);
  expect(screen.getByRole('button', { name: '2026-09-01' })).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectStyles } from './check_web_styles.mjs';

test('task styles cannot be appended to global CSS or another owner', () => {
  const result = inspectStyles([
    ['styles.css', '.task-row { padding: 0 }'],
    ['components/tasks/task-monitor.css', '.task-date-trigger { color: red }'],
  ]);
  assert.equal(result.problems.length, 2);
  assert.match(result.problems[0], /task-history.css/);
  assert.match(result.problems[1], /task-date-filter.css/);
});

test('selector lists do not hide duplicates; responsive and state variants remain valid', () => {
  const result = inspectStyles([
    [
      'components/tasks/task-history.css',
      '.task-row, .task-main { padding: 0 } .task-row { border: 0 } .task-row:hover { border: 1px } @media (max-width: 900px) { .task-row { padding: 1px } }',
    ],
  ]);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /duplicate selector/);
});

test('task rules reject hidden priority and obsolete ancestor dependencies', () => {
  const result = inspectStyles([
    [
      'components/tasks/task-history.css',
      '.view-content .task-panel.is-expanded .task-row { padding: 0 !important; padding: 1px }',
    ],
  ]);
  assert.equal(result.problems.length, 3);
});

test('legacy fallbacks and keyframes survive the conservative check', () => {
  const result = inspectStyles([
    [
      'styles.css',
      '.x { color: red; color: blue } .y { color: red !important } .y { color: blue } @keyframes x { from { opacity: 0 } to { opacity: 1 } }',
    ],
  ]);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.shadowed, []);
});

test('legacy duplicates are found without conflating media conditions', () => {
  const result = inspectStyles([
    [
      'styles.css',
      '.x { color: red } .x { color: blue } @media (max-width: 900px) { .x { color: green } }',
    ],
  ]);
  assert.equal(result.shadowed.length, 1);
  assert.equal(result.shadowed[0].value, 'red');
});

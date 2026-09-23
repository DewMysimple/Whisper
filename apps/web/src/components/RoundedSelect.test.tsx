import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { RoundedSelect } from './RoundedSelect';

it('shares the themed menu across pages while preserving keyboard and disabled-option behavior', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <>
      <RoundedSelect
        label="执行设备"
        value="auto"
        onChange={onChange}
        options={[
          { id: 'auto', label: '自动选择' },
          { id: 'cuda', label: 'GPU', disabled: true },
          { id: 'cpu', label: 'CPU' },
        ]}
      />
      <button type="button">下一控件</button>
    </>,
  );
  const control = screen.getByRole('combobox', { name: '执行设备' });
  await user.click(control);
  expect(screen.getByRole('option', { name: 'GPU' })).toBeDisabled();
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onChange).toHaveBeenCalledWith('cpu');
  expect(control).toHaveAttribute('aria-expanded', 'false');
  await user.click(control);
  await user.keyboard('{Escape}');
  expect(control).toHaveFocus();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  await user.click(control);
  await user.click(screen.getByRole('button', { name: '下一控件' }));
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

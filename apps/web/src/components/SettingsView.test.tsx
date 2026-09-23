import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useWorkspace } from '../state/workspace';
import { SettingsView } from './SettingsView';

it('discards an incomplete numeric draft on Escape without committing its clamped value on blur', () => {
  useWorkspace.setState({ ...useWorkspace.getInitialState(), topbarHeight: 116 });
  render(<SettingsView />);
  const input = screen.getByRole('spinbutton', { name: '顶栏高度数值' });
  input.focus();
  fireEvent.change(input, { target: { value: '1' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(useWorkspace.getState().topbarHeight).toBe(116);
  expect(input).toHaveValue('116');
});

it('applies the three interface-size presets together and reflects manual changes', () => {
  useWorkspace.setState({
    ...useWorkspace.getInitialState(),
    uiFontSize: 14,
    workspaceFontSize: 14,
    logFontSize: 13,
  });
  render(<SettingsView />);

  const balanced = screen.getByRole('radio', { name: '平衡' });
  expect(balanced).toBeChecked();
  expect(balanced.closest('.preference-choice-card')).toHaveClass('is-selected');
  expect(
    screen.getByRole('radio', { name: '跟随 Windows' }).closest('.preference-choice-card'),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole('radio', { name: '偏小' }));
  expect(useWorkspace.getState()).toMatchObject({
    uiFontSize: 12,
    workspaceFontSize: 12,
    logFontSize: 11,
  });
  expect(screen.getByRole('radio', { name: '偏小' })).toBeChecked();

  fireEvent.click(screen.getByRole('radio', { name: '偏大' }));
  expect(useWorkspace.getState()).toMatchObject({
    uiFontSize: 16,
    workspaceFontSize: 16,
    logFontSize: 15,
  });
  act(() => useWorkspace.getState().setLogFontSize(16));
  expect(screen.getByRole('radio', { name: '偏大' })).not.toBeChecked();
  for (const radio of screen.getAllByRole('radio', { name: /^(偏小|平衡|偏大)$/ })) {
    expect(radio).not.toBeChecked();
  }

  fireEvent.click(balanced);
  expect(useWorkspace.getState()).toMatchObject({
    uiFontSize: 14,
    workspaceFontSize: 14,
    logFontSize: 13,
  });
  expect(balanced).toBeChecked();
});

import { fireEvent, render, screen } from '@testing-library/react';
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

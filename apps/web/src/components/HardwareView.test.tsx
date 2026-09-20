import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { desktopBridge } from '../bridge';
import { HardwareView } from './HardwareView';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('shows the native Host error and disables unsupported choices when detection fails', async () => {
  vi.spyOn(desktopBridge, 'getHardwareCapabilities').mockRejectedValue({
    code: 'host.not_ready',
    message: '本地 Worker 尚未就绪',
  });
  render(<HardwareView />);
  expect(await screen.findByRole('alert')).toHaveTextContent('本地 Worker 尚未就绪');
  expect(screen.getByLabelText('执行设备', { exact: true })).toBeDisabled();
  expect(screen.getByRole('button', { name: /GPU 加速/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: '重新检测' })).toBeEnabled();
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import App from './App';

describe('desktop workspace', () => {
  it('previews input, derived custom parameters, and output policy without a Worker', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText('MOCK BRIDGE')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '选择多个文件' }));
    expect(await screen.findByText('P20-核心语法-整数类型.mp4')).toBeInTheDocument();

    const beamSize = screen.getByRole('spinbutton', { name: 'Beam size' });
    await user.clear(beamSize);
    await user.type(beamSize, '6');
    expect(screen.getByText('派生自定义')).toBeInTheDocument();

    await user.click(screen.getByText('Markdown'));
    expect(screen.getByText('自定义模式')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /媒体旁 \/ Text/ }));
    expect(screen.getByText('D:\\字幕项目\\2026-07')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /开始本地转录/ })).toBeEnabled();
  });

  it('keeps a quoted Windows path intact when adding pasted input', async () => {
    const user = userEvent.setup();
    render(<App />);

    const path = '"D:\\媒体素材\\访谈 01.mp4"';
    await user.type(screen.getByRole('textbox', { name: '粘贴 Windows 路径' }), path);
    await user.click(screen.getByRole('button', { name: '添加路径' }));
    expect(await screen.findByText(path)).toBeInTheDocument();
  });
});

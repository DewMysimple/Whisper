import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import App from './App';

describe('desktop workspace', () => {
  it('starts in the transcription workspace without a personal desk and exposes only Ctrl+Enter', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('heading', { name: '转录工作台' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '打开 Mysimple 个人主页' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('CTRL + ENTER')).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: '主导航' });
    expect(
      within(navigation)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['转录工作台', '模型切换', '性能监控', '任务记录2', 'Worker 日志', '偏好设置']);

    const sidebarToggle = screen.getByRole('button', { name: '收起侧边栏' });
    await user.click(sidebarToggle);
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    expect(screen.getByRole('button', { name: /切换为.+主题/ })).toBeInTheDocument();
  });

  it('previews input, derived custom parameters, and output policy without a Worker', async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    render(<App />);
    expect(screen.getByText('MOCK BRIDGE')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '最近任务' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择媒体文件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加文件夹' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '选择媒体文件' }));
    expect(await screen.findByText('P20-核心语法-整数类型.mp4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '添加文件夹' }));
    expect(await screen.findByText('七月产品会议')).toBeInTheDocument();
    expect(screen.getByLabelText('待转录媒体队列')).toHaveTextContent('共 8 个媒体文件');

    const beamSize = screen.getByRole('spinbutton', { name: 'Beam size' });
    await user.clear(beamSize);
    await user.type(beamSize, '6');
    expect(screen.getByText('派生自定义')).toBeInTheDocument();

    await user.click(screen.getByText('Markdown'));
    expect(screen.getByText('跟随媒体')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '选择输出文件夹' }));
    expect(screen.getByText('D:\\字幕项目\\2026-07')).toBeInTheDocument();
    expect(screen.getByText('自选目录')).toBeInTheDocument();
    const txtCopy = screen.getByRole('checkbox', { name: '同时在媒体旁保存 TXT 副本' });
    const markdownCopy = screen.getByRole('checkbox', {
      name: '同时在媒体旁保存 Markdown 副本',
    });
    expect(txtCopy).not.toBeChecked();
    expect(markdownCopy).not.toBeChecked();
    await user.click(txtCopy);
    await user.click(markdownCopy);
    expect(txtCopy).toBeChecked();
    expect(markdownCopy).toBeChecked();
    await user.click(screen.getByRole('button', { name: '恢复默认位置' }));
    expect(screen.getByText('跟随媒体')).toBeInTheDocument();
    expect(screen.queryByText('D:\\字幕项目\\2026-07')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: '同时在媒体旁保存 TXT 副本' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('在每个媒体文件旁创建 Text、Markdown 文件夹，文件直接存放'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /开始本地转录/ })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /开始本地转录/ }));
    expect(screen.getByRole('dialog', { name: '确认使用标准转录版本？' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续转录' }));
    expect(await screen.findByRole('heading', { name: '性能监控' })).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    scrollTo.mockRestore();
  });

  it('keeps a quoted Windows path intact when adding pasted input', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '转录工作台' }));
    const path = '"D:\\媒体素材\\访谈 01.mp4"';
    await user.click(screen.getByRole('button', { name: '粘贴 Windows 路径' }));
    await user.type(screen.getByRole('textbox', { name: '粘贴 Windows 路径' }), path);
    await user.click(screen.getByRole('button', { name: '添加路径' }));
    expect(await screen.findByText(path)).toBeInTheDocument();
    expect(screen.getByLabelText('待转录媒体队列')).toHaveTextContent(path);
  });

  it('routes Ctrl+Enter through the standard preset confirmation', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '选择媒体文件' }));

    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(screen.getByRole('dialog', { name: '确认使用标准转录版本？' })).toHaveTextContent(
      '英文转录',
    );
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(
      screen.queryByRole('dialog', { name: '确认使用标准转录版本？' }),
    ).not.toBeInTheDocument();

    const presetPanel = screen.getByRole('heading', { name: '文本识别与参数' }).closest('section');
    expect(presetPanel).not.toBeNull();
    await user.click(within(presetPanel!).getByRole('button', { name: /英文防幻觉/ }));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByRole('heading', { name: '性能监控' })).toBeInTheDocument();
  });

  it('maps performance, task and runtime views to real workspace state', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '模型切换' }));
    expect(await screen.findByRole('heading', { name: '当前推理模型' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本地模型库' })).toBeInTheDocument();
    expect(screen.getByText('2 / 6')).toBeInTheDocument();
    const mediumCard = screen.getByRole('heading', { name: 'Medium' }).closest('article');
    expect(mediumCard).not.toBeNull();
    await user.click(within(mediumCard!).getByRole('button', { name: '设为转录模型' }));
    expect(within(mediumCard!).getByRole('button', { name: '等待生效' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '性能监控' }));
    expect(screen.getByRole('heading', { name: '任务进度监视' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /当前任务进度/ })).toHaveAttribute(
      'aria-valuemax',
      '100',
    );
    expect(screen.getByRole('heading', { name: 'GPU 负载详情' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: 'GPU 负载 最近 15 秒本机性能趋势，80 乘 20 个正方形采样格',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('15s')).toBeInTheDocument();
    expect(screen.getByText('7.5s')).toBeInTheDocument();
    expect(screen.getByText('时间范围 15s 至现在', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('60 次前')).not.toBeInTheDocument();
    const gpuTelemetry = screen.getByLabelText('GPU 负载实时硬件与进程指标');
    expect(within(gpuTelemetry).getByText('GPU 温度')).toBeInTheDocument();
    expect(within(gpuTelemetry).getByText('核心频率')).toBeInTheDocument();
    expect(within(gpuTelemetry).getByText('实时功耗')).toBeInTheDocument();
    expect(within(gpuTelemetry).getByText('NVIDIA 驱动')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /显存占用/ }));
    const metricDetail = screen.getByRole('heading', { name: '显存占用详情' }).closest('section');
    expect(metricDetail).not.toBeNull();
    expect(within(metricDetail!).getByText('当前使用率')).toBeInTheDocument();
    expect(within(metricDetail!).getByText('15 秒判断')).toBeInTheDocument();
    expect(within(metricDetail!).getByText('15 秒平均')).toBeInTheDocument();
    expect(within(metricDetail!).getByText('15 秒峰值')).toBeInTheDocument();
    expect(within(metricDetail!).getByText('15 秒低点')).toBeInTheDocument();
    expect(within(metricDetail!).getByText('窗口变化')).toBeInTheDocument();
    expect(within(metricDetail!).getAllByText('显存可用', { exact: false }).length).toBeGreaterThan(
      0,
    );
    expect(within(metricDetail!).getByText('同一时刻 GPU 负载')).toBeInTheDocument();
    expect(within(metricDetail!).queryByText('计算设备')).not.toBeInTheDocument();
    expect(within(metricDetail!).queryByText('当前会话')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /CPU 负载/ }));
    expect(screen.getByText('系统总体空闲余量')).toBeInTheDocument();
    const cpuTelemetry = screen.getByLabelText('CPU 负载实时硬件与进程指标');
    expect(within(cpuTelemetry).getByText('Intel(R) Core(TM) i7-14700KF')).toBeInTheDocument();
    expect(within(cpuTelemetry).getByText('系统报告频率')).toBeInTheDocument();
    expect(within(cpuTelemetry).getByText('物理核心')).toBeInTheDocument();
    expect(within(cpuTelemetry).getByText('逻辑处理器')).toBeInTheDocument();
    expect(within(cpuTelemetry).getByText('Worker 句柄')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /内存占用/ }));
    expect(screen.getByText('系统内存可用', { exact: false })).toBeInTheDocument();
    const memoryTelemetry = screen.getByLabelText('内存占用实时硬件与进程指标');
    expect(within(memoryTelemetry).getByText('交换空间')).toBeInTheDocument();
    expect(within(memoryTelemetry).getByText('Worker 常驻内存')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /任务记录/ }));
    expect(screen.getByLabelText('任务概览')).toHaveTextContent('全部任务');
    expect(screen.getByRole('heading', { name: '任务队列与本地历史' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /清除已完成历史/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /清除异常历史/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /全部日期/ })).toBeInTheDocument();
    expect(screen.getByText('2026-07-22 21:42')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '删除 设计评审会议.m4a 的任务记录' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '删除 Product Interview 06.mkv 的任务记录' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Worker 日志' }));
    expect(screen.getByRole('heading', { name: '实时诊断输出' })).toBeInTheDocument();
    expect(screen.getByLabelText('Worker 日志状态')).toHaveTextContent('BUFFER');

    await user.click(screen.getByRole('button', { name: '偏好设置' }));
    expect(screen.getByRole('heading', { name: '本地运行环境' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Worker 日志' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /清除已结束历史/ })).not.toBeInTheDocument();
    expect(screen.getByText('网络端口')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '跟随系统' })).toBeChecked();
    expect(screen.getByRole('group', { name: 'UI 字号' })).toHaveTextContent('14px');
    expect(screen.getByRole('group', { name: '日志字号' })).toHaveTextContent('12px');
    await user.click(screen.getByRole('button', { name: '增大UI 字号' }));
    expect(document.documentElement.style.getPropertyValue('--ui-font-size')).toBe('15px');
    expect(document.documentElement.style.getPropertyValue('--log-font-size')).toBe('12px');
    await user.click(screen.getByRole('button', { name: '蓝色强调色' }));
    expect(document.documentElement).toHaveAttribute('data-accent-preset', 'blue');
    expect(screen.getByRole('button', { name: '恢复橙色' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '恢复橙色' }));
    expect(document.documentElement).toHaveAttribute('data-accent-preset', 'orange');
    await user.selectOptions(screen.getByRole('combobox', { name: 'UI 字体' }), 'dengxian');
    expect(document.documentElement.style.getPropertyValue('--ui-font-family')).toContain(
      'DengXian',
    );
    await user.click(screen.getByRole('button', { name: '恢复外观默认值' }));
    expect(document.documentElement.style.getPropertyValue('--ui-font-size')).toBe('14px');
  });

  it('activates the independent SRT profile with complete custom controls', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '转录工作台' }));

    const subtitlePanel = screen
      .getByRole('heading', { name: 'SRT 字幕识别与参数' })
      .closest('section');
    expect(subtitlePanel).not.toBeNull();
    await user.click(within(subtitlePanel!).getByRole('button', { name: /中文防幻觉/ }));

    expect(within(subtitlePanel!).getByText('当前输出 SRT')).toBeInTheDocument();
    expect(screen.getByLabelText('当前 SRT 输出摘要')).toHaveTextContent('SRT 字幕');
    expect(screen.getByRole('spinbutton', { name: 'Compression ratio' })).toHaveValue(2);
    expect(screen.getByRole('spinbutton', { name: 'Log probability' })).toHaveValue(-1.5);
    expect(screen.getByRole('spinbutton', { name: 'VAD 最短静音' })).toHaveValue(500);
    expect(screen.getByRole('spinbutton', { name: '每行最多字符' })).toHaveValue(18);
    expect(screen.getByRole('spinbutton', { name: '每条最多行数' })).toHaveValue(1);

    const maxCharacters = screen.getByRole('spinbutton', { name: '每行最多字符' });
    await user.clear(maxCharacters);
    await user.type(maxCharacters, '22');
    expect(within(subtitlePanel!).getByText('字幕自定义')).toBeInTheDocument();
  });

  it('exposes only runtime-supported hardware controls below the model library', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '模型切换' }));

    expect(await screen.findByRole('heading', { name: '硬件优化' })).toBeInTheDocument();
    const devices = screen.getByRole('group', { name: '推理设备' });
    expect(within(devices).getByRole('button', { name: '自动' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(devices).getByRole('button', { name: 'CPU' }));
    await user.selectOptions(screen.getByRole('combobox', { name: /^CPU 计算精度/ }), 'float32');
    await user.click(screen.getByRole('button', { name: /应用硬件设置/ }));

    expect(screen.getByText('等待后续任务生效')).toBeInTheDocument();
    expect(within(devices).getByRole('button', { name: 'CPU' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: /恢复推荐配置/ }));
    expect(within(devices).getByRole('button', { name: '自动' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

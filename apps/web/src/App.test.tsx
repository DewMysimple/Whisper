import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import App from './App';
import { useWorkspace } from './state/workspace';

describe('desktop workspace', () => {
  it('starts in the transcription workspace without a personal desk and exposes only Ctrl+Enter', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('heading', { name: '转录工作台' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '打开 Mysimple 个人主页' }),
    ).not.toBeInTheDocument();
    const startButton = screen.getByRole('button', { name: /开始本地转录/ });
    expect(within(startButton).getByText('CTRL + ENTER')).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: '主导航' });
    expect(
      within(navigation)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['转录工作台', '性能监控', '任务监控与记录2', 'Worker 日志', '偏好设置']);
    expect(screen.queryByRole('button', { name: '硬件优化' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '模型切换' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /查看并修改当前模型与模式/ }),
    ).not.toBeInTheDocument();

    const sidebarToggle = screen.getByRole('button', { name: '收起侧边栏' });
    await user.click(sidebarToggle);
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    expect(screen.getByRole('button', { name: /切换为.+主题/ })).toBeInTheDocument();
  });

  it('previews input and output policy without a Worker', async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    render(<App />);
    expect(screen.getByText('MOCK BRIDGE')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '最近任务' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择媒体文件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加文件夹' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '无操作' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关机' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '休眠' })).not.toBeInTheDocument();
    const checklist = screen.getByLabelText('执行前清单');
    expect(checklist).toHaveTextContent('版本与模型');
    expect(checklist).toHaveTextContent('英文转录');
    expect(checklist).toHaveTextContent('Large V3 Turbo');
    expect(checklist).toHaveTextContent('媒体信息0 个媒体0 项输入来源 · 00:00 · 0 秒');
    expect(checklist).toHaveTextContent('输出策略TXT跟随每个媒体文件');
    expect(checklist).toHaveTextContent('执行方式原声转录完成后无操作本地 Worker 已就绪');
    expect(within(checklist).getByText('跟随每个媒体文件', { exact: true })).toBeInTheDocument();
    expect(
      within(checklist).getByText('同名时执行前确认覆盖', { exact: true }),
    ).toBeInTheDocument();
    expect(within(checklist).getByText('完成后无操作', { exact: true })).toBeInTheDocument();
    expect(within(checklist).getByText('本地 Worker 已就绪', { exact: true })).toBeInTheDocument();
    const checklistLinks = [
      within(checklist).getByRole('button', { name: '前往版本与模型配置' }),
      within(checklist).getByRole('button', { name: '前往输入来源配置' }),
      within(checklist).getByRole('button', { name: '前往输出策略配置' }),
      within(checklist).getByRole('button', { name: '前往执行方式配置' }),
    ];
    for (const link of checklistLinks) {
      expect(link).toHaveClass('selection-card');
      expect(link).not.toHaveClass('is-selected');
      expect(link).not.toHaveAttribute('aria-pressed');
    }
    await user.click(checklistLinks[0]!);
    expect(
      screen
        .getByRole('heading', { name: '文本识别模式' })
        .closest('section')
        ?.querySelector('.preset-card[aria-pressed="true"]'),
    ).toHaveFocus();
    await user.click(checklistLinks[1]!);
    expect(screen.getByRole('button', { name: '选择媒体文件' })).toHaveFocus();
    await user.click(checklistLinks[2]!);
    expect(screen.getByRole('button', { name: '选择输出文件夹' })).toHaveFocus();
    await user.click(checklistLinks[3]!);
    expect(screen.getByRole('button', { name: '无操作' })).toHaveFocus();
    expect(
      screen.queryByText('添加媒体后，这里会汇总本次任务的完整配置。'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '媒体队列' })).not.toBeInTheDocument();
    expect(screen.queryByText(/中／英文版本只决定断句/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '选择媒体文件' }));
    expect(await screen.findByText('P20-核心语法-整数类型.mp4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '添加文件夹' }));
    expect(await screen.findByText('七月产品会议')).toBeInTheDocument();
    expect(screen.getByLabelText('执行前清单')).toHaveTextContent(
      '媒体信息10 个媒体3 项输入来源 · 01:21:30 · 4,890 秒',
    );
    expect(screen.getByLabelText('待转录输入来源')).toHaveTextContent('8 个媒体 · 01:00:00');

    await user.click(screen.getByRole('checkbox', { name: '生成 Markdown 格式' }));
    expect(screen.getByText('跟随媒体')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '选择输出文件夹' }));
    expect(screen.getAllByText('D:\\字幕项目\\2026-07')).toHaveLength(2);
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
    expect(screen.getByRole('dialog', { name: '确认使用标准转录版本' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续转录' }));
    expect(await screen.findByRole('heading', { name: '性能监控' })).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    scrollTo.mockRestore();
  });

  it('keeps retired recognition strategies out of the transcription workspace', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '转录工作台' }));
    const presetPanel = screen.getByRole('heading', { name: '文本识别模式' }).closest('section');
    expect(presetPanel).not.toBeNull();
    await user.click(within(presetPanel!).getByRole('button', { name: /中文防幻觉/ }));

    expect(screen.queryByRole('group', { name: '识别策略' })).not.toBeInTheDocument();
    expect(screen.queryByText('复杂中英混合')).not.toBeInTheDocument();
    expect(screen.queryByText('中文细节增强')).not.toBeInTheDocument();
    expect(useWorkspace.getState().recognitionStrategy).toBe('stable_primary');
  });

  it('requires a separate shutdown confirmation after the standard preset warning', async () => {
    const user = userEvent.setup();
    useWorkspace.setState({
      activeView: 'workspace',
      inputs: [],
      selectedPresetId: 'en_v1',
      finishAction: 'none',
      pendingOverwrite: null,
      pendingShutdownStart: null,
      shutdownArmed: false,
      startingTask: false,
    });
    render(<App />);
    await user.click(screen.getByRole('button', { name: '选择媒体文件' }));
    await user.click(screen.getByRole('button', { name: '关机' }));
    expect(screen.getByRole('button', { name: '关机' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: /开始本地转录/ }));
    expect(screen.getByRole('dialog', { name: '确认使用标准转录版本' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续转录' }));
    expect(
      await screen.findByRole('dialog', { name: '确认任务完成后关闭电脑' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('heading', { name: '性能监控' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('待转录输入来源')).toHaveTextContent('P20-核心语法-整数类型.mp4');
    expect(screen.getByRole('button', { name: '关机' })).toHaveAttribute('aria-pressed', 'true');

    await user.keyboard('{Control>}{Enter}{/Control}');
    await user.click(screen.getByRole('button', { name: '继续转录' }));
    await user.click(screen.getByRole('button', { name: '确认并开始转录' }));
    expect(await screen.findByRole('heading', { name: '性能监控' })).toBeInTheDocument();
  });

  it('automatically clears the top error banner after five seconds', () => {
    vi.useFakeTimers();
    render(<App />);
    act(() => useWorkspace.setState({ lastError: '剪贴板内容无效' }));
    expect(screen.getByRole('alert')).toHaveTextContent('剪贴板内容无效');
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByText('剪贴板内容无效')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('reads quoted Windows paths directly from the clipboard', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '转录工作台' }));
    await user.click(screen.getByRole('button', { name: '粘贴 Windows 路径' }));
    expect(await screen.findByText('剪贴板课程 01.mp4')).toBeInTheDocument();
    expect(screen.getByLabelText('执行前清单')).toHaveTextContent(
      '媒体信息2 个媒体2 项输入来源 · 09:35 · 575 秒',
    );
    expect(screen.getByLabelText('待转录输入来源')).toHaveTextContent('剪贴板课程 02.wav');
  });

  it('routes Ctrl+Enter through the standard preset confirmation', async () => {
    const user = userEvent.setup();
    useWorkspace.setState({
      activeView: 'workspace',
      inputs: [],
      selectedPresetId: 'en_v1',
      finishAction: 'none',
      pendingOverwrite: null,
      pendingShutdownStart: null,
      shutdownArmed: false,
      startingTask: false,
    });
    render(<App />);
    await user.click(screen.getByRole('button', { name: '选择媒体文件' }));

    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(screen.getByRole('dialog', { name: '确认使用标准转录版本' })).toHaveTextContent(
      '英文转录',
    );
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog', { name: '确认使用标准转录版本' })).not.toBeInTheDocument();

    const presetPanel = screen.getByRole('heading', { name: '文本识别模式' }).closest('section');
    expect(presetPanel).not.toBeNull();
    await user.click(within(presetPanel!).getByRole('button', { name: /英文防幻觉/ }));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByRole('heading', { name: '性能监控' })).toBeInTheDocument();
  });

  it('maps performance, task and runtime views to real workspace state', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '性能监控' }));
    expect(screen.getByRole('heading', { name: '任务进度监视' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /整体任务进度/ })).toHaveAttribute(
      'aria-valuemax',
      '100',
    );
    expect(screen.getByRole('progressbar', { name: /当前媒体进度/ })).toHaveAttribute(
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

    await user.click(screen.getByRole('button', { name: /任务监控与记录/ }));
    const taskSwitcher = screen.getByLabelText('任务监控与历史记录');
    expect(within(taskSwitcher).getByRole('button', { name: /任务监控/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(taskSwitcher).getByRole('button', { name: /历史记录/ }));
    expect(screen.getByLabelText('任务概览')).toHaveTextContent('全部任务');
    expect(screen.getByRole('heading', { name: '本机任务历史' })).toBeInTheDocument();
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
    expect(screen.getByRole('radio', { name: '跟随 Windows' })).toBeChecked();
    expect(screen.getByText(/跟随 Windows 的浅色或深色应用模式/)).toBeInTheDocument();
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
    const srtOutput = screen.getByRole('checkbox', { name: '生成 SRT 格式' });
    const txtOutput = screen.getByRole('checkbox', { name: '生成 TXT 格式' });
    expect(srtOutput).toBeChecked();
    expect(txtOutput).not.toBeChecked();
    await user.click(txtOutput);
    expect(srtOutput).toBeChecked();
    expect(txtOutput).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: '每行最多字符' })).toHaveValue(18);
    expect(screen.getByRole('spinbutton', { name: '每条最多行数' })).toHaveValue(1);

    const maxCharacters = screen.getByRole('spinbutton', { name: '每行最多字符' });
    await user.clear(maxCharacters);
    await user.type(maxCharacters, '22');
    expect(within(subtitlePanel!).getByText('字幕自定义')).toBeInTheDocument();

    expect(screen.queryByRole('spinbutton', { name: 'Compression ratio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Log probability' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'VAD 最短静音' })).not.toBeInTheDocument();
  });
});

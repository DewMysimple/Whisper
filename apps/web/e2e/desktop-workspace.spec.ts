import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '转录工作台' })).toBeVisible();
  await expect(page.getByText('MOCK BRIDGE')).toBeVisible();
});

test('keeps the requested desktop card and empty-path geometry', async ({ page }) => {
  const measure = () =>
    page.evaluate(() => {
      const rect = (selector: string) => {
        const bounds = document.querySelector(selector)!.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      };
      return {
        source: rect('.source-panel'),
        output: rect('.output-panel'),
        preset: rect('.preset-panel:not(.subtitle-profile-panel)'),
        launch: rect('.launch-card'),
      };
    });
  const transcript = await measure();
  expect(transcript.source.height).toBeCloseTo(transcript.output.height, 5);

  await page.getByRole('button', { name: '粘贴 Windows 路径' }).click();
  const pathGeometry = await page.evaluate(() => {
    const textarea = document
      .querySelector('.directory-path-input textarea')!
      .getBoundingClientRect();
    const label = document.querySelector('.directory-path-input > span')!.getBoundingClientRect();
    return {
      textareaCenter: { x: textarea.x + textarea.width / 2, y: textarea.y + textarea.height / 2 },
      labelCenter: { x: label.x + label.width / 2, y: label.y + label.height / 2 },
    };
  });
  expect(pathGeometry.labelCenter.x).toBeCloseTo(pathGeometry.textareaCenter.x, 5);
  expect(pathGeometry.labelCenter.y).toBeCloseTo(pathGeometry.textareaCenter.y, 5);

  await page.locator('.subtitle-profile-panel .preset-card').first().click();
  const subtitle = await measure();
  expect(subtitle.source.height).toBeCloseTo(subtitle.output.height, 5);
  await page.locator('.workspace-grid').evaluate((element) => {
    element.removeAttribute('data-profile-mode');
  });
  const subtitleWithoutAdjustment = await measure();
  expect(subtitle.preset.height - subtitleWithoutAdjustment.preset.height).toBeCloseTo(3, 5);
  expect(subtitle.launch.height - subtitleWithoutAdjustment.launch.height).toBeCloseTo(3, 5);

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(
    page
      .locator('.workspace-grid')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
  ).resolves.toBe(1);
});

test('manages the local model library without interrupting queued work', async ({
  page,
}, testInfo) => {
  await page.getByRole('button', { name: '模型切换' }).click();
  await expect(page.getByRole('heading', { name: '当前推理模型' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '本地模型库' })).toBeVisible();
  await expect(page.locator('.model-card')).toHaveCount(6);
  await expect(page.getByText('2 / 6')).toBeVisible();
  await expect(page.getByRole('button', { name: '打开模型目录' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '硬件优化' })).toBeVisible();
  const hardware = page.locator('.hardware-optimizer');
  await expect(hardware.getByRole('button', { name: '自动' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(hardware.getByRole('combobox', { name: /^CUDA 计算精度/ })).toContainText(
    'INT8 + FP16',
  );

  const mediumCard = page
    .locator('.model-card')
    .filter({ has: page.getByRole('heading', { name: 'Medium' }) });
  await expect(mediumCard).toContainText('已完整安装');
  await mediumCard.getByRole('button', { name: '设为转录模型' }).click();
  await expect(mediumCard.getByRole('button', { name: '等待生效' })).toBeVisible();
  await expect(page.getByText('当前队列结束后生效')).toBeVisible();

  const tinyCard = page
    .locator('.model-card')
    .filter({ has: page.getByRole('heading', { name: 'Tiny' }) });
  await expect(tinyCard.getByRole('button', { name: '设为转录模型' })).toBeDisabled();
  await expect(tinyCard).toContainText('请放入 models\\tiny');
  await expect(
    mediumCard
      .getByRole('button', { name: '等待生效' })
      .evaluate((element) => getComputedStyle(element).color),
  ).resolves.toBe('rgb(255, 255, 255)');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('model-library-light.png') });

  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.waitForTimeout(250);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('model-library-dark.png') });
});

test('creates a task from the complete desktop workspace path', async ({ page }, testInfo) => {
  await expect(page.getByRole('heading', { name: '最近任务' })).toHaveCount(0);
  await expect(
    page
      .locator('.source-action-button')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).resolves.toBe('13px');
  await expect(
    page
      .locator('.parameter-field')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).resolves.toBe('12px');
  await expect(
    page
      .locator('.output-section-heading')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).resolves.toBe('12px');
  await expect(page.getByRole('button', { name: '选择媒体文件' })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加文件夹' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '粘贴 Windows 路径' })).toHaveCount(0);
  await page.getByRole('button', { name: '选择媒体文件' }).click();
  await expect(page.getByText('P20-核心语法-整数类型.mp4', { exact: true })).toBeVisible();
  await expect(page.getByLabel('待转录媒体队列')).toContainText('P20-核心语法-整数类型.mp4');
  await page.getByRole('button', { name: '添加文件夹' }).click();
  await expect(page.getByLabel('待转录媒体队列')).toContainText('共 8 个媒体文件');

  const beamSize = page.getByRole('spinbutton', { name: 'Beam size' });
  await beamSize.fill('6');
  await expect(page.getByText('派生自定义')).toBeVisible();

  await page.getByText('Markdown', { exact: true }).click();
  await expect(page.getByText('跟随媒体')).toBeVisible();
  await page.getByRole('button', { name: '选择输出文件夹' }).click();
  await expect(page.getByText('D:\\字幕项目\\2026-07')).toBeVisible();
  await expect(
    page.getByText('Text、Markdown 文件直接写入所选目录，不创建格式子文件夹'),
  ).toBeVisible();
  const txtCopy = page.getByRole('checkbox', { name: '同时在媒体旁保存 TXT 副本' });
  const markdownCopy = page.getByRole('checkbox', {
    name: '同时在媒体旁保存 Markdown 副本',
  });
  await expect(txtCopy).not.toBeChecked();
  await expect(markdownCopy).not.toBeChecked();
  await txtCopy.check();
  await markdownCopy.check();
  const changeDirectory = page.getByRole('button', { name: '更换文件夹' });
  const restoreDirectory = page.getByRole('button', { name: '恢复默认位置' });
  await expect
    .poll(async () =>
      Promise.all([
        changeDirectory.evaluate((element) => getComputedStyle(element).color),
        restoreDirectory.evaluate((element) => getComputedStyle(element).color),
      ]),
    )
    .toEqual(['rgb(29, 29, 31)', 'rgb(255, 91, 4)']);
  await page.locator('.output-panel').screenshot({
    path: testInfo.outputPath('output-custom-location.png'),
  });
  await page.getByRole('button', { name: '恢复默认位置' }).click();
  await expect(page.getByText('跟随媒体')).toBeVisible();
  await expect(page.getByText('D:\\字幕项目\\2026-07')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('workspace-ready-light.png'),
  });
  const startTask = page.getByRole('button', { name: /开始本地转录/ });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await startTask.evaluate((element: HTMLButtonElement) => element.click());
  await expect(page.getByRole('dialog', { name: '确认使用标准转录版本？' })).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('standard-preset-confirmation.png'),
  });
  await page.getByRole('button', { name: '继续转录' }).click();
  await expect(page.getByRole('heading', { name: '性能监控' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole('button', { name: /任务记录/ })).toContainText('3');
  await page.getByRole('button', { name: '转录工作台' }).click();
  await expect(page.getByRole('heading', { name: '最近任务' })).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('workspace-running-light.png'),
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.waitForTimeout(300);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('workspace-running-dark.png'),
  });
});

test('supports workspace navigation, theme and configuration export', async ({
  page,
}, testInfo) => {
  await expect(
    page
      .locator('.preset-panel')
      .first()
      .evaluate((element) => getComputedStyle(element).padding),
  ).resolves.toBe('22px');
  await expect(
    page
      .locator('.preset-card')
      .first()
      .evaluate((element) => getComputedStyle(element).minHeight),
  ).resolves.toBe('116px');
  await expect(
    page.locator('.parameter-grid').evaluate((element) => getComputedStyle(element).rowGap),
  ).resolves.toBe('10px');
  await expect(
    page
      .locator('.parameter-field input')
      .first()
      .evaluate((element) => getComputedStyle(element).minHeight),
  ).resolves.toBe('38px');
  await page.getByRole('button', { name: '性能监控' }).click();
  await expect(page.getByRole('heading', { name: '性能监控' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '实时性能趋势' })).toBeVisible();
  const heatmap = page.getByRole('img', { name: /80 乘 20 个正方形采样格/ });
  await expect(heatmap.locator('.heat-column')).toHaveCount(80);
  await expect(heatmap.locator('.heat-column').first().locator('span')).toHaveCount(20);
  await expect(heatmap).toHaveAttribute('aria-label', /最近 15 秒本机性能趋势/);
  await expect(page.locator('.x-axis')).toHaveText(/15s.*7\.5s.*现在/);
  await expect(page.locator('.sample-note')).toContainText('时间范围 15s 至现在');
  await expect(page.getByText('60 次前')).toHaveCount(0);
  const telemetry = page.locator('.metric-telemetry-grid');
  await expect(telemetry).toHaveAttribute('aria-label', 'GPU 负载实时硬件与进程指标');
  await expect(telemetry.locator('.metric-telemetry-card')).toHaveCount(8);
  await expect(telemetry).toContainText('GPU 温度');
  await expect(telemetry).toContainText('核心频率');
  await expect(telemetry).toContainText('实时功耗');
  await expect(telemetry).toContainText('NVIDIA 驱动');
  await expect(
    page
      .locator('.metric-selector strong')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).resolves.toBe('21px');
  await page.getByRole('button', { name: /显存占用/ }).click();
  await expect(page.getByRole('heading', { name: '显存占用详情' })).toBeVisible();
  const metricDetail = page.locator('.metric-detail');
  await expect(telemetry).toHaveAttribute('aria-label', '显存占用实时硬件与进程指标');
  await expect(telemetry.locator('.metric-telemetry-card')).toHaveCount(6);
  await expect(telemetry).toContainText('显存控制器');
  await expect(metricDetail.getByText('当前使用率')).toBeVisible();
  await expect(metricDetail.getByText('15 秒判断')).toBeVisible();
  await expect(metricDetail.locator('.metric-stat')).toHaveCount(4);
  await expect(metricDetail.locator('.metric-context-card')).toHaveCount(2);
  await expect(metricDetail).toContainText('15 秒平均');
  await expect(metricDetail).toContainText('15 秒峰值');
  await expect(metricDetail).toContainText('15 秒低点');
  await expect(metricDetail).toContainText('窗口变化');
  await expect(metricDetail).toContainText('显存可用');
  await expect(metricDetail.getByText('计算设备')).toHaveCount(0);
  await expect(metricDetail.getByText('当前会话')).toHaveCount(0);
  await expect(
    metricDetail
      .locator('.metric-current-reading strong')
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).resolves.toBe('40px');

  await page.getByRole('button', { name: /CPU 负载/ }).click();
  await expect(metricDetail).toContainText('系统总体空闲余量');
  await expect(metricDetail).toContainText('同一时刻系统内存');
  await expect(telemetry).toHaveAttribute('aria-label', 'CPU 负载实时硬件与进程指标');
  await expect(telemetry.locator('.metric-telemetry-card')).toHaveCount(8);
  await expect(telemetry).toContainText('Intel(R) Core(TM) i7-14700KF');
  await expect(telemetry).toContainText('系统报告频率');
  await expect(telemetry).toContainText('物理核心');
  await expect(telemetry).toContainText('Worker 句柄');

  await page.getByRole('button', { name: /内存占用/ }).click();
  await expect(metricDetail).toContainText('系统内存可用');
  await expect(metricDetail).toContainText('同一时刻 CPU 负载');
  await expect(telemetry).toHaveAttribute('aria-label', '内存占用实时硬件与进程指标');
  await expect(telemetry.locator('.metric-telemetry-card')).toHaveCount(6);
  await expect(telemetry).toContainText('交换空间');
  await expect(telemetry).toContainText('Worker 常驻内存');
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.waitForTimeout(350);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('performance-light.png') });

  await page.getByRole('button', { name: '偏好设置' }).click();
  await expect(page.getByRole('heading', { name: '桌面外观' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '本地运行环境' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '跟随系统' })).toBeChecked();
  await expect(page.getByRole('group', { name: 'UI 字号' })).toContainText('14px');
  await expect(page.getByRole('group', { name: '日志字号' })).toContainText('12px');
  await expect(page.getByRole('button', { name: '橙色强调色' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: '恢复橙色' })).toBeDisabled();
  await page.getByRole('button', { name: '蓝色强调色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent-preset', 'blue');
  await expect(page.getByRole('button', { name: '恢复橙色' })).toBeEnabled();
  await page.getByRole('textbox', { name: '自定义强调色十六进制' }).fill('#12345');
  await expect(page.getByRole('alert')).toContainText('请输入完整的十六进制颜色');
  await page.getByRole('textbox', { name: '自定义强调色十六进制' }).fill('#2A7FFF');
  await expect(page.locator('html')).toHaveAttribute('data-accent-preset', 'custom');
  await expect(
    page.locator('html').evaluate((element) => element.style.getPropertyValue('--accent')),
  ).resolves.toBe('#2A7FFF');
  await page.getByRole('button', { name: '恢复橙色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent-preset', 'orange');
  await page.getByRole('combobox', { name: 'UI 字体' }).selectOption('dengxian');
  await page.getByRole('combobox', { name: '等宽字体' }).selectOption('consolas');
  await expect(
    page.locator('html').evaluate((element) => element.style.getPropertyValue('--ui-font-family')),
  ).resolves.toContain('DengXian');
  await expect(
    page.locator('html').evaluate((element) => element.style.getPropertyValue('--mono')),
  ).resolves.toContain('Consolas');

  await page.getByRole('button', { name: '增大UI 字号' }).click();
  await page.getByRole('button', { name: '增大UI 字号' }).click();
  await expect(page.getByRole('group', { name: 'UI 字号' })).toContainText('16px');
  await expect(
    page.locator('html').evaluate((element) => element.style.getPropertyValue('--ui-font-size')),
  ).resolves.toBe('16px');
  await expect(
    page.locator('html').evaluate((element) => element.style.getPropertyValue('--log-font-size')),
  ).resolves.toBe('12px');
  await page.getByRole('button', { name: '转录工作台' }).click();
  await expect(
    page
      .locator('.parameter-field')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).resolves.toBe('14px');
  await expect(
    page
      .locator('.preset-panel')
      .first()
      .evaluate((element) => getComputedStyle(element).padding),
  ).resolves.toBe('22px');
  await expect(
    page
      .locator('.preset-card')
      .first()
      .evaluate((element) => getComputedStyle(element).minHeight),
  ).resolves.toBe('116px');
  await expect(
    page.locator('.parameter-grid').evaluate((element) => getComputedStyle(element).rowGap),
  ).resolves.toBe('10px');
  await expect(
    page
      .locator('.parameter-field input')
      .first()
      .evaluate((element) => getComputedStyle(element).minHeight),
  ).resolves.toBe('38px');
  await expect(
    page.locator('.output-panel').evaluate((element) => element.clientWidth),
  ).resolves.toBeGreaterThanOrEqual(330);
  await expect(
    page
      .locator('.workspace-grid')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
  ).resolves.toBe(2);
  await page.getByRole('button', { name: '性能监控' }).click();
  await expect(
    page
      .locator('.metric-selector strong')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).resolves.toBe('23px');
  await expect(
    page.locator('.metric-detail').evaluate((element) => getComputedStyle(element).padding),
  ).resolves.toBe('26px');
  await expect(
    page
      .locator('.metric-telemetry-card')
      .first()
      .evaluate((element) => getComputedStyle(element).minHeight),
  ).resolves.toBe('86px');
  await page.getByRole('button', { name: /任务记录/ }).click();
  await expect(
    page
      .locator('.task-summary-card strong')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).resolves.toBe('28px');
  await expect(
    page
      .locator('.task-summary-card')
      .first()
      .evaluate((element) => getComputedStyle(element).padding),
  ).resolves.toBe('18px');
  await page.getByRole('button', { name: '偏好设置' }).click();
  await page.getByRole('button', { name: '增大UI 字号' }).click();
  await page.getByRole('button', { name: '增大UI 字号' }).click();
  await expect(page.getByRole('group', { name: 'UI 字号' })).toContainText('18px');
  await expect(page.getByRole('button', { name: '增大UI 字号' })).toBeDisabled();
  await page.getByRole('button', { name: '增大日志字号' }).click();
  await expect(page.getByRole('group', { name: '日志字号' })).toContainText('13px');
  await page.getByRole('button', { name: '转录工作台' }).click();
  await expect(
    page
      .locator('.parameter-field')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).resolves.toBe('16px');
  await expect(
    page
      .locator('.preset-panel')
      .first()
      .evaluate((element) => getComputedStyle(element).padding),
  ).resolves.toBe('22px');
  await expect(
    page
      .locator('.preset-card')
      .first()
      .evaluate((element) => getComputedStyle(element).minHeight),
  ).resolves.toBe('116px');
  await expect(
    page.locator('.parameter-grid').evaluate((element) => getComputedStyle(element).rowGap),
  ).resolves.toBe('10px');
  await expect(
    page
      .locator('.parameter-field input')
      .first()
      .evaluate((element) => getComputedStyle(element).minHeight),
  ).resolves.toBe('38px');
  await expect(page.locator('.output-panel')).toBeVisible();
  await expect(page.locator('.launch-card')).toBeVisible();
  await page.getByRole('button', { name: '粘贴 Windows 路径' }).click();
  await expect(
    page
      .locator('.path-paste-row textarea')
      .evaluate((element) => getComputedStyle(element).minHeight),
  ).resolves.toBe('62px');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('workspace-large.png') });
  await page.getByRole('button', { name: '性能监控' }).click();
  await expect(
    page
      .locator('.metric-selector strong')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).resolves.toBe('25px');
  await expect(
    page.locator('.metric-detail').evaluate((element) => getComputedStyle(element).padding),
  ).resolves.toBe('26px');
  await expect(
    page
      .locator('.metric-telemetry-card')
      .first()
      .evaluate((element) => getComputedStyle(element).minHeight),
  ).resolves.toBe('86px');
  await page.getByRole('button', { name: '偏好设置' }).click();

  await page.getByText('浅色', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '生成导出配置' }).click();
  await expect(page.getByRole('textbox', { name: '配置 JSON' })).toContainText('schemaVersion');
  await expect(page.getByRole('textbox', { name: '配置 JSON' })).toContainText('"uiFontSize": 18');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('settings-light.png') });
  await page.getByText('深色', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(250);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('settings-dark.png') });
  await page.getByText('浅色', { exact: true }).click();

  await page.getByRole('button', { name: /任务记录/ }).click();
  await expect(page.getByRole('heading', { name: '任务队列与本地历史' })).toBeVisible();
  await expect(page.getByLabel('任务概览')).toContainText('全部任务');
  await expect(
    page
      .locator('.task-summary-card strong')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).resolves.toBe('30px');
  await expect(
    page
      .locator('.task-summary-card')
      .first()
      .evaluate((element) => getComputedStyle(element).padding),
  ).resolves.toBe('18px');
  await page.getByRole('searchbox', { name: '搜索任务' }).fill('Interview');
  await expect(page.getByText('Product Interview 06.mkv', { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('tasks-light.png') });
});

test('opens an accessible task detail and output preview', async ({ page }) => {
  await page.getByRole('button', { name: /任务记录/ }).click();
  const retry = page.getByRole('button', { name: '重新转录 Product Interview 06.mkv' });
  await expect(retry).toHaveAttribute('data-tooltip', '重新转录');
  await retry.click();
  await expect(page.getByRole('dialog', { name: '确认重新转录？' })).toContainText(
    'Product Interview 06.mkv',
  );
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByText('Product Interview 06.mkv').click();
  await expect(page.getByRole('dialog', { name: 'Product Interview 06.mkv' })).toBeVisible();
  await expect(page.getByText('This is a local output preview')).toBeVisible();
  await page.getByRole('button', { name: '按此快照重试' }).click();
  await expect(page.getByRole('dialog', { name: '确认重新转录？' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '关闭任务详情' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('monitors the active task and manages dated history in a responsive grid', async ({
  page,
}, testInfo) => {
  await page.getByRole('button', { name: '性能监控' }).click();
  const monitor = page.getByRole('region', { name: '任务进度监视' });
  await expect(monitor).toContainText('设计评审会议.m4a');
  await expect(monitor.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '63');
  await expect(
    page.evaluate(() => {
      const trend = document.querySelector('.performance-trend')!.getBoundingClientRect();
      const progress = document.querySelector('.task-progress-monitor')!.getBoundingClientRect();
      return Math.abs(trend.width - progress.width);
    }),
  ).resolves.toBeLessThan(1);

  await page.getByRole('button', { name: /任务记录/ }).click();
  await expect(
    page
      .locator('.task-panel.is-expanded .task-list')
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
      ),
  ).resolves.toBe(2);

  await page.getByRole('button', { name: '全部日期' }).click();
  const calendar = page.getByRole('dialog', { name: '按任务日期筛选' });
  await expect(calendar.getByRole('button', { name: '2026-07-22' })).toBeEnabled();
  await expect(calendar.getByRole('button', { name: '2026-07-20' })).toBeDisabled();
  await page.waitForTimeout(220);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('task-date-calendar.png') });
  await calendar.getByRole('button', { name: '2026-07-22' }).click();
  await expect(page.getByText('设计评审会议.m4a')).toBeVisible();
  await expect(page.getByText('Product Interview 06.mkv')).toHaveCount(0);
  await calendar.getByRole('button', { name: '2026-07-21' }).click();
  await expect(page.getByText('Product Interview 06.mkv')).toBeVisible();

  const remove = page.getByRole('button', {
    name: '删除 Product Interview 06.mkv 的任务记录',
  });
  await expect(remove).toHaveAttribute('data-tooltip', '删除任务记录');
  await remove.click();
  await expect(remove).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Product Interview 06.mkv', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /删除任务记录/ })).toHaveCount(0);
  await page
    .getByRole('button', { name: '再次点击删除 Product Interview 06.mkv 的任务记录' })
    .click();
  await expect(page.getByText('Product Interview 06.mkv')).toHaveCount(0);

  await expect(page.getByRole('button', { name: '删除 设计评审会议.m4a 的任务记录' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: /取消 设计评审会议.m4a/ }).click();
  await page.getByRole('button', { name: '性能监控' }).click();
  await expect(page.getByRole('region', { name: '任务进度监视' })).toContainText(
    '当前没有正在执行的任务',
  );

  await page.setViewportSize({ width: 1000, height: 900 });
  await page.getByRole('button', { name: /任务记录/ }).click();
  await expect(
    page
      .locator('.task-panel.is-expanded .task-list')
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
      ),
  ).resolves.toBe(1);
});

test('clears completed and abnormal history independently', async ({ page }) => {
  await page.getByRole('button', { name: /任务记录/ }).click();

  const clearCompleted = page.getByRole('button', { name: /清除已完成历史 · 1/ });
  const clearAbnormal = page.getByRole('button', { name: /清除异常历史 · 0/ });
  await expect(clearCompleted).toBeEnabled();
  await expect(clearAbnormal).toBeDisabled();
  await clearCompleted.click();
  const confirmClearCompleted = page.getByRole('button', { name: /再次点击清除/ });
  await expect(confirmClearCompleted).toHaveAttribute('aria-pressed', 'true');
  await confirmClearCompleted.click();
  await expect(page.getByText('Product Interview 06.mkv')).toHaveCount(0);

  await page.getByRole('button', { name: /取消 设计评审会议.m4a/ }).click();
  const clearCancelled = page.getByRole('button', { name: /清除异常历史 · 1/ });
  await expect(clearCancelled).toBeEnabled();
  await clearCancelled.click();
  await page.getByRole('button', { name: /再次点击清除/ }).click();
  await expect(page.getByText('设计评审会议.m4a')).toHaveCount(0);
});

test('creates an SRT task from the independent subtitle profile', async ({ page }, testInfo) => {
  const subtitlePanel = page
    .getByRole('heading', { name: 'SRT 字幕识别与参数' })
    .locator('xpath=ancestor::section');
  await subtitlePanel.getByRole('button', { name: /中文防幻觉/ }).click();
  await expect(subtitlePanel.getByText('当前输出 SRT')).toBeVisible();
  await expect(page.getByLabel('当前 SRT 输出摘要')).toContainText('1 行 × 每行 18 字符');
  await expect(page.getByRole('spinbutton', { name: 'Compression ratio' })).toHaveValue('2');
  await expect(page.getByRole('spinbutton', { name: 'Log probability' })).toHaveValue('-1.5');
  await expect(page.getByRole('spinbutton', { name: 'VAD 最短静音' })).toHaveValue('500');
  await page.getByRole('spinbutton', { name: '每行最多字符' }).fill('22');
  await expect(subtitlePanel.getByText('字幕自定义')).toBeVisible();
  await subtitlePanel.scrollIntoViewIfNeeded();
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('srt-profile-custom.png') });

  await page.getByRole('button', { name: '选择媒体文件' }).click();
  await expect(page.getByRole('button', { name: /开始生成 SRT 字幕/ })).toBeEnabled();
  await page.getByRole('button', { name: /开始生成 SRT 字幕/ }).click();
  await expect(page.getByRole('heading', { name: '性能监控' })).toBeVisible();
  await expect(page.getByRole('button', { name: /任务记录/ })).toContainText('3');
});

test('opens the independent Worker log workspace and exposes only the restored shortcut', async ({
  page,
}, testInfo) => {
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await expect(navigation.getByRole('button')).toHaveText([
    '转录工作台',
    '模型切换',
    '性能监控',
    /任务记录/,
    'Worker 日志',
    '偏好设置',
  ]);
  await expect(page.getByText('CTRL + ENTER')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '打开 Mysimple 个人主页' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Worker 日志' }).click();
  await expect(page.getByRole('heading', { name: '实时诊断输出' })).toBeVisible();
  await expect(page.getByLabel('Worker 日志状态')).toContainText('BUFFER');
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('worker-logs.png') });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('worker-logs-dark.png') });
});

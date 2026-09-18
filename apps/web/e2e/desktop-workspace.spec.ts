import { expect, test, type Locator } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '转录工作台' })).toBeVisible();
  await expect(page.getByText('MOCK BRIDGE')).toBeVisible();
  await expect(
    page.locator('.help-trigger, .help-popover, [data-tooltip], .has-tooltip, [title]'),
  ).toHaveCount(0);
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
        subtitlePanel: rect('.subtitle-profile-panel'),
        launch: rect('.launch-card'),
      };
    });
  const transcript = await measure();
  expect(transcript.source.height).toBeCloseTo(transcript.output.height, 1);
  expect(transcript.preset.y).toBeCloseTo(transcript.launch.y, 1);
  expect(transcript.preset.height).toBeCloseTo(transcript.launch.height, 1);
  const headingGaps = await page.evaluate(() => {
    const gap = (labelSelector: string, headingSelector: string) => {
      const label = document.querySelector(labelSelector)!.getBoundingClientRect();
      const heading = document.querySelector(headingSelector)!.getBoundingClientRect();
      return heading.top - label.bottom;
    };
    return {
      source: gap('.source-panel .step-label', '.source-panel h2'),
      output: gap('.output-panel .step-label', '.output-panel h2'),
      launch: gap('.launch-card .step-label', '.launch-card h2'),
    };
  });
  expect(headingGaps.launch).toBeCloseTo(headingGaps.source, 1);
  expect(headingGaps.launch).toBeCloseTo(headingGaps.output, 1);
  const launchHeadingAlignment = await page.evaluate(() => {
    const label = document.querySelector('.launch-card .step-label')!.getBoundingClientRect();
    const title = document.querySelector('.launch-card h2')!.getBoundingClientRect();
    const status = document.querySelector('.preflight-status')!.getBoundingClientRect();
    return {
      labelTop: label.top,
      titleTop: title.top,
      statusTop: status.top,
    };
  });
  expect(launchHeadingAlignment.statusTop).toBeCloseTo(launchHeadingAlignment.labelTop, 1);
  expect(launchHeadingAlignment.statusTop).toBeLessThan(launchHeadingAlignment.titleTop);
  const preflightLayout = await page.evaluate(() => {
    const list = document.querySelector('.preflight-list')!;
    const presetGrid = document.querySelector(
      '.preset-panel:not(.subtitle-profile-panel) .preset-grid',
    )!;
    const items = [...document.querySelectorAll('.preflight-item')].map((item) =>
      item.getBoundingClientRect().toJSON(),
    );
    const presetItems = [
      ...document.querySelectorAll('.preset-panel:not(.subtitle-profile-panel) .preset-card'),
    ].map((item) => item.getBoundingClientRect().toJSON());
    const firstItem = document.querySelector('.preflight-item')!;
    const attentionItem = document.querySelector('.preflight-item.needs-attention')!;
    const icon = firstItem.querySelector('.preflight-icon')!.getBoundingClientRect();
    const copy = firstItem.querySelector('.preflight-copy')!.getBoundingClientRect();
    const detailLines = [...document.querySelectorAll('.preflight-detail-lines')].map((detail) =>
      [...detail.children].map((line) => line.getBoundingClientRect().toJSON()),
    );
    const detailLineHeight = Number.parseFloat(
      getComputedStyle(document.querySelector('.preflight-detail-lines')!).lineHeight,
    );
    const submitLabel = document.querySelector('.launch-submit-label')!;
    const shortcut = document.querySelector('.launch-shortcut')!;
    return {
      firstItemHeight: firstItem.getBoundingClientRect().height,
      listTop: list.getBoundingClientRect().top,
      listBottom: list.getBoundingClientRect().bottom,
      presetGridTop: presetGrid.getBoundingClientRect().top,
      presetGridBottom: presetGrid.getBoundingClientRect().bottom,
      listGap: Number.parseFloat(getComputedStyle(list).rowGap),
      presetGridGap: Number.parseFloat(getComputedStyle(presetGrid).rowGap),
      columnCount: getComputedStyle(list).gridTemplateColumns.split(' ').length,
      itemBorderStyle: getComputedStyle(firstItem).borderTopStyle,
      itemRadius: Number.parseFloat(getComputedStyle(firstItem).borderTopLeftRadius),
      itemBackground: getComputedStyle(firstItem).backgroundColor,
      attentionBackground: getComputedStyle(attentionItem).backgroundColor,
      items,
      presetItems,
      iconBottom: icon.bottom,
      copyTop: copy.top,
      detailLines,
      detailLineHeight,
      submitLabelFontSize: Number.parseFloat(getComputedStyle(submitLabel).fontSize),
      shortcutFontSize: Number.parseFloat(getComputedStyle(shortcut).fontSize),
      shortcutIconCount: shortcut.querySelectorAll('svg').length,
    };
  });
  expect(preflightLayout.firstItemHeight).toBeCloseTo(160, 1);
  expect(preflightLayout.listTop).toBeCloseTo(preflightLayout.presetGridTop, 1);
  expect(preflightLayout.listBottom).toBeCloseTo(preflightLayout.presetGridBottom, 1);
  expect(preflightLayout.listGap).toBeGreaterThanOrEqual(8);
  expect(preflightLayout.listGap).toBeCloseTo(preflightLayout.presetGridGap, 1);
  expect(preflightLayout.columnCount).toBe(2);
  expect(preflightLayout.items).toHaveLength(4);
  expect(preflightLayout.presetItems).toHaveLength(4);
  expect(
    Math.max(...preflightLayout.items.map((item) => item.height)) -
      Math.min(...preflightLayout.items.map((item) => item.height)),
  ).toBeLessThan(0.1);
  expect(
    Math.max(...preflightLayout.items.map((item) => item.width)) -
      Math.min(...preflightLayout.items.map((item) => item.width)),
  ).toBeLessThan(0.1);
  expect(
    Math.max(...preflightLayout.presetItems.map((item) => item.height)) -
      Math.min(...preflightLayout.presetItems.map((item) => item.height)),
  ).toBeLessThan(0.1);
  expect(preflightLayout.items[0].top).toBeCloseTo(preflightLayout.items[1].top, 1);
  expect(preflightLayout.items[2].top).toBeCloseTo(preflightLayout.items[3].top, 1);
  expect(preflightLayout.items[2].top).toBeGreaterThan(preflightLayout.items[0].top);
  expect(preflightLayout.items[0].left).toBeCloseTo(preflightLayout.items[2].left, 1);
  expect(preflightLayout.items[1].left).toBeCloseTo(preflightLayout.items[3].left, 1);
  expect(preflightLayout.items[1].left).toBeGreaterThan(preflightLayout.items[0].left);
  expect(preflightLayout.items[0].top).toBeCloseTo(preflightLayout.presetItems[0].top, 1);
  expect(preflightLayout.items[0].bottom).toBeCloseTo(preflightLayout.presetItems[0].bottom, 1);
  expect(preflightLayout.items[2].top).toBeCloseTo(preflightLayout.presetItems[2].top, 1);
  expect(preflightLayout.items[2].bottom).toBeCloseTo(preflightLayout.presetItems[2].bottom, 1);
  expect(preflightLayout.copyTop).toBeGreaterThanOrEqual(preflightLayout.iconBottom);
  expect(preflightLayout.detailLines).toHaveLength(2);
  for (const lines of preflightLayout.detailLines) {
    expect(lines).toHaveLength(2);
    expect(lines[0].height).toBeCloseTo(preflightLayout.detailLineHeight, 1);
    expect(lines[1].height).toBeCloseTo(preflightLayout.detailLineHeight, 1);
    expect(lines[1].top).toBeGreaterThanOrEqual(lines[0].bottom);
  }
  expect(preflightLayout.shortcutFontSize).toBeCloseTo(preflightLayout.submitLabelFontSize, 1);
  expect(preflightLayout.shortcutIconCount).toBe(0);
  expect(preflightLayout.itemBorderStyle).toBe('solid');
  expect(preflightLayout.itemRadius).toBeGreaterThanOrEqual(10);
  expect(preflightLayout.attentionBackground).not.toBe(preflightLayout.itemBackground);
  const stateChipLayout = await page.evaluate(() => {
    const active = document.querySelector<HTMLElement>(
      '.preset-panel:not(.subtitle-profile-panel) .mode-chip',
    )!;
    const inactive = document.querySelector<HTMLElement>('.subtitle-profile-panel .mode-chip')!;
    const pending = document.querySelector<HTMLElement>('.preflight-status')!;
    const iconTextOffset = (chip: HTMLElement) => {
      const icon = chip.querySelector('svg')!.getBoundingClientRect();
      const text = chip.lastChild!;
      const range = document.createRange();
      range.selectNode(text);
      const textRect = range.getBoundingClientRect();
      return Math.abs(icon.top + icon.height / 2 - (textRect.top + textRect.height / 2));
    };
    return {
      activeHeight: active.getBoundingClientRect().height,
      inactiveHeight: inactive.getBoundingClientRect().height,
      pendingHeight: pending.getBoundingClientRect().height,
      inactiveColor: getComputedStyle(inactive).color,
      pendingColor: getComputedStyle(pending).color,
      inactiveBackground: getComputedStyle(inactive).backgroundColor,
      pendingBackground: getComputedStyle(pending).backgroundColor,
      inactiveBorderStyle: getComputedStyle(inactive).borderTopStyle,
      pendingBorderStyle: getComputedStyle(pending).borderTopStyle,
      inactiveIconWidth: inactive.querySelector('svg')!.getBoundingClientRect().width,
      inactiveIcon: inactive.querySelector('svg')?.classList.contains('lucide-captions'),
      pendingIcon: pending.querySelector('svg')?.classList.contains('lucide-triangle-alert'),
      activeOffset: iconTextOffset(active),
      inactiveOffset: iconTextOffset(inactive),
      pendingOffset: iconTextOffset(pending),
    };
  });
  expect(stateChipLayout.activeHeight).toBeCloseTo(stateChipLayout.inactiveHeight, 1);
  expect(stateChipLayout.pendingHeight).toBeCloseTo(stateChipLayout.inactiveHeight, 1);
  expect(stateChipLayout.pendingColor).not.toBe(stateChipLayout.inactiveColor);
  expect(stateChipLayout.pendingBackground).not.toBe(stateChipLayout.inactiveBackground);
  expect(stateChipLayout.inactiveBorderStyle).toBe('none');
  expect(stateChipLayout.pendingBorderStyle).toBe('solid');
  expect(stateChipLayout.inactiveIconWidth).toBeCloseTo(13, 1);
  expect(stateChipLayout.inactiveIcon).toBe(true);
  expect(stateChipLayout.pendingIcon).toBe(true);
  expect(
    Math.max(
      stateChipLayout.activeOffset,
      stateChipLayout.inactiveOffset,
      stateChipLayout.pendingOffset,
    ),
  ).toBeLessThanOrEqual(1);

  const intakeRatio = await page.evaluate(() => {
    const local = document.querySelector('.drop-zone')!.getBoundingClientRect();
    const clipboard = document.querySelector('.clipboard-intake')!.getBoundingClientRect();
    return local.height / clipboard.height;
  });
  expect(intakeRatio).toBeGreaterThan(1.8);
  expect(intakeRatio).toBeLessThan(2.8);
  await page.getByRole('button', { name: '粘贴 Windows 路径' }).click();
  await expect(page.getByLabel('执行前清单')).toContainText(
    '媒体信息2 个媒体2 项输入来源 · 09:35 · 575 秒',
  );
  await expect(page.getByRole('button', { name: '查看 2 个媒体文件进度' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '粘贴 Windows 路径' })).toHaveCount(0);

  await page.locator('.subtitle-profile-panel .preset-card').first().click();
  await expect(
    page.locator('.preset-panel:not(.subtitle-profile-panel) .mode-chip .lucide-file-text'),
  ).toBeVisible();
  await expect(page.locator('.subtitle-profile-panel .mode-chip .lucide-check')).toBeVisible();
  const subtitle = await measure();
  expect(subtitle.source.height).toBeCloseTo(subtitle.output.height, 1);
  expect(subtitle.preset.height).toBeCloseTo(subtitle.launch.height, 1);
  expect(subtitle.launch.height).toBeGreaterThan(transcript.launch.height);
  await expect(
    page.locator('.subtitle-parameter-field > .parameter-field-label').first(),
  ).toHaveCSS('display', 'flex');
  const subtitleUnitRightGaps = await page
    .locator('.subtitle-parameter-field > .parameter-field-label')
    .evaluateAll((labels) =>
      labels.map((label) => {
        const unit = label.querySelector('em');
        if (!unit) return Number.POSITIVE_INFINITY;
        return Math.abs(label.getBoundingClientRect().right - unit.getBoundingClientRect().right);
      }),
    );
  expect(Math.max(...subtitleUnitRightGaps)).toBeLessThan(1);
  await expect(
    page.locator('.preset-panel:not(.subtitle-profile-panel) .inference-parameter-editor'),
  ).toHaveCount(0);
  expect(subtitle.subtitlePanel.height).toBeGreaterThan(transcript.subtitlePanel.height);

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(
    page
      .locator('.workspace-grid')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
  ).resolves.toBe(1);
});

test('uses the same subtle press feedback for selectable cards', async ({ page }) => {
  const pressAndReadTransform = async (card: Locator) => {
    await card.scrollIntoViewIfNeeded();
    const bounds = await card.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.down();
    try {
      await expect
        .poll(() => card.evaluate((element) => getComputedStyle(element).transform))
        .not.toBe('none');
    } finally {
      await page.mouse.up();
    }
  };

  const transcriptMode = page
    .locator('.preset-panel:not(.subtitle-profile-panel) .preset-card')
    .first();
  const preflightProfile = page.getByRole('button', { name: '前往版本与模型配置' });
  const selectedFormat = page.locator('.output-format-list .output-format-option').first();
  const markdownFormat = page.locator('.output-format-list .output-format-option').nth(1);
  const finishAction = page.getByRole('button', { name: '无操作' });

  await expect(transcriptMode).toHaveClass(/selection-card/);
  await expect(preflightProfile).toHaveClass(/selection-card/);
  await expect(preflightProfile).not.toHaveClass(/is-selected/);
  await expect(preflightProfile).not.toHaveAttribute('aria-pressed');
  await expect(markdownFormat).toHaveClass(/selection-card/);
  await expect(finishAction).toHaveClass(/selection-card/);
  await pressAndReadTransform(transcriptMode);
  await pressAndReadTransform(preflightProfile);
  await pressAndReadTransform(markdownFormat);
  await pressAndReadTransform(finishAction);

  const selectedIcon = selectedFormat.locator('.output-format-code');
  const selectedColors = await selectedIcon.evaluate((element) => {
    const style = getComputedStyle(element);
    return { backgroundColor: style.backgroundColor, color: style.color };
  });
  await selectedFormat.hover();
  await expect
    .poll(() =>
      selectedIcon.evaluate((element) => {
        const style = getComputedStyle(element);
        return { backgroundColor: style.backgroundColor, color: style.color };
      }),
    )
    .toEqual(selectedColors);
  await expect(markdownFormat.locator('.output-format-code')).toHaveCSS('outline-style', 'none');
});

test('uses preflight cards as non-selecting configuration shortcuts', async ({ page }) => {
  const routes = [
    {
      shortcut: page.getByRole('button', { name: '前往版本与模型配置' }),
      target: page.locator(
        '.preset-panel:not(.subtitle-profile-panel) .preset-card[aria-pressed="true"]',
      ),
    },
    {
      shortcut: page.getByRole('button', { name: '前往输入来源配置' }),
      target: page.getByRole('button', { name: '选择媒体文件' }),
    },
    {
      shortcut: page.getByRole('button', { name: '前往输出策略配置' }),
      target: page.getByRole('button', { name: '选择输出文件夹' }),
    },
    {
      shortcut: page.getByRole('button', { name: '前往执行方式配置' }),
      target: page.getByRole('button', { name: '无操作' }),
    },
  ];

  await page.evaluate(() => window.scrollTo(0, 0));
  for (const { shortcut, target } of routes) {
    await shortcut.evaluate((element: HTMLButtonElement) => element.click());
    await expect(target).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(shortcut).not.toHaveClass(/is-selected/);
    await expect(shortcut).not.toHaveAttribute('aria-pressed');
  }
});

test('does not expose the retired model switching workbench', async ({ page }) => {
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await expect(navigation.getByRole('button', { name: '模型切换' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /查看并修改当前模型与模式/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '当前推理模型' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '本地模型库' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '当前模型参数' })).toHaveCount(0);
});

test('does not expose the retired hardware optimization workbench', async ({ page }) => {
  await expect(page.locator('[title]')).toHaveCount(0);
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await expect(navigation.getByRole('button', { name: '硬件优化' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '硬件优化' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: '推理设备' })).toHaveCount(0);
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
      .locator('.output-setting-card-heading small')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).resolves.toBe('12px');
  await expect(page.locator('.output-settings-grid > .output-setting-card')).toHaveCount(4);
  await expect(
    page
      .locator('.output-settings-grid')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
  ).resolves.toBe(1);
  const outputCardOverflow = await page.locator('.output-setting-card').evaluateAll((cards) =>
    cards.map((card) => ({
      horizontal: card.scrollWidth - card.clientWidth,
      vertical: card.scrollHeight - card.clientHeight,
    })),
  );
  expect(
    Math.max(...outputCardOverflow.map((overflow) => overflow.horizontal)),
  ).toBeLessThanOrEqual(1);
  expect(Math.max(...outputCardOverflow.map((overflow) => overflow.vertical))).toBeLessThanOrEqual(
    1,
  );
  const conflictPolicy = page.getByRole('group', { name: '同名冲突策略' });
  await expect(conflictPolicy.getByRole('button')).toHaveText(['覆盖', '跳过', '重命名']);
  await expect(conflictPolicy.getByRole('button', { name: '覆盖' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await conflictPolicy.getByRole('button', { name: '跳过' }).click();
  await expect(conflictPolicy.getByRole('button', { name: '跳过' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: '选择媒体文件' })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加文件夹' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '粘贴 Windows 路径' })).toHaveCount(0);
  await page.getByRole('button', { name: '选择媒体文件' }).click();
  await page.getByRole('button', { name: '添加文件夹' }).click();
  await expect(page.getByLabel('执行前清单')).toContainText(
    '媒体信息10 个媒体3 项输入来源 · 01:21:30 · 4,890 秒',
  );
  await expect(page.getByText('任务清单已更新，确认无误后开始本地处理。')).toHaveCount(0);
  await page.getByRole('button', { name: '查看 10 个媒体文件进度' }).click();
  await expect(page.getByRole('heading', { name: '媒体文件进度' })).toBeVisible();
  await expect(page.locator('.task-media-row')).toHaveCount(10);
  await expect(page.getByText('P20-核心语法-整数类型.mp4', { exact: true })).toBeVisible();
  await expect(page.getByText('七月产品会议-01.mp4', { exact: true })).toBeVisible();
  await expect(page.getByText('七月产品会议-08.mp4', { exact: true })).toBeVisible();
  await expect(page.getByText('已展开 10 个待处理媒体文件')).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('task-input-preview.png'),
  });
  await page.getByRole('button', { name: '转录工作台' }).click();
  await expect(page.getByRole('heading', { name: '媒体队列' })).toHaveCount(0);

  await expect(page.locator('.output-format-copy')).toHaveCount(0);
  await expect(page.locator('.output-format-list .output-format-option')).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: '生成 TXT 格式' })).toBeChecked();
  await page.getByRole('checkbox', { name: '生成 Markdown 格式' }).check();
  await expect(page.getByText('跟随媒体')).toBeVisible();
  await page.getByRole('button', { name: '选择输出文件夹' }).click();
  await expect(
    page.getByLabel('文件输出').getByText('D:\\字幕项目\\2026-07', { exact: true }),
  ).toBeVisible();
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
  await expect(page.getByRole('dialog', { name: '确认使用标准转录版本' })).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('standard-preset-confirmation.png'),
  });
  await page.getByRole('button', { name: '继续转录' }).click();
  await expect(page.getByRole('heading', { name: '性能监控' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(
    page.getByRole('button', { name: /任务监控与记录/ }).locator('.nav-count'),
  ).toHaveText(/^(?:[1-9]|10)$/);
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

test('confirms the one-time shutdown action without exposing hibernate', async ({
  page,
}, testInfo) => {
  await expect(page.getByRole('button', { name: '休眠' })).toHaveCount(0);
  await page.getByRole('button', { name: '选择媒体文件' }).click();
  await page.getByRole('button', { name: '关机' }).click();
  await page.getByRole('button', { name: /开始本地转录/ }).click();
  await expect(page.getByRole('dialog', { name: '确认使用标准转录版本' })).toBeVisible();
  await page.getByRole('button', { name: '继续转录' }).click();
  const shutdownDialog = page.getByRole('dialog', { name: '确认任务完成后关闭电脑' });
  await expect(shutdownDialog).toBeVisible();
  await expect(shutdownDialog).toContainText('60 秒关机倒计时');
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('shutdown-confirmation.png'),
  });
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByLabel('执行前清单')).toContainText('媒体信息2 个媒体');
  await expect(page.getByRole('button', { name: '关机' })).toHaveAttribute('aria-pressed', 'true');

  await page
    .locator('.preset-panel:not(.subtitle-profile-panel) .preset-card')
    .filter({ hasText: '中文防幻觉' })
    .click();
  await page.getByRole('button', { name: /开始本地转录/ }).click();
  await page.getByRole('button', { name: '确认并开始转录' }).click();
  await expect(page.getByRole('heading', { name: '性能监控' })).toBeVisible();
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
  ).resolves.toBe('98px');
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
  await expect(page.getByRole('radio', { name: '跟随 Windows' })).toBeChecked();
  await expect(page.getByText('固定使用明亮背景与深色文字')).toHaveCount(0);
  await expect(page.getByText('固定使用深色背景与浅色文字')).toHaveCount(0);
  await expect(page.getByRole('group', { name: '界面框架字号' })).toContainText('14px');
  await expect(page.getByRole('group', { name: '工作台内容字号' })).toContainText('14px');
  await expect(page.getByRole('group', { name: 'Worker 日志字号' })).toContainText('13px');
  await expect(page.getByRole('button', { name: '橙色强调色' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: '恢复橙色' })).toBeDisabled();
  await page.getByRole('button', { name: '蓝色强调色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent-preset', 'blue');
  await expect(
    page.locator('.brand-mark').evaluate((element) => getComputedStyle(element).backgroundImage),
  ).resolves.not.toContain('rgb(255, 117, 45)');
  const presetGradients = [
    await page
      .locator('.brand-mark')
      .evaluate((element) => getComputedStyle(element).backgroundImage),
  ];
  for (const [label, preset] of [
    ['绿色强调色', 'green'],
    ['紫色强调色', 'purple'],
  ] as const) {
    await page.getByRole('button', { name: label }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent-preset', preset);
    presetGradients.push(
      await page
        .locator('.brand-mark')
        .evaluate((element) => getComputedStyle(element).backgroundImage),
    );
  }
  expect(new Set(presetGradients).size).toBe(3);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('settings-purple-accent.png'),
  });
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
  await page.getByRole('button', { name: '打开自定义强调色编辑器' }).click();
  await expect(page.getByRole('dialog', { name: '自定义强调色编辑器' })).toBeVisible();
  await page.getByRole('button', { name: '选择颜色 #6E5AE6' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent-preset', 'custom');
  const uiFontControl = page.getByRole('combobox', { name: 'UI 字体' });
  await uiFontControl.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await uiFontControl.click();
  await page.getByRole('option', { name: 'DengXian' }).click();
  await page.getByRole('combobox', { name: '等宽字体' }).click();
  await page.getByRole('option', { name: 'Consolas' }).click();
  await expect(
    page.locator('html').evaluate((element) => element.style.getPropertyValue('--ui-font-family')),
  ).resolves.toContain('DengXian');
  await expect(
    page.locator('html').evaluate((element) => element.style.getPropertyValue('--mono')),
  ).resolves.toContain('Consolas');

  await page.getByRole('button', { name: '增大界面框架字号' }).click();
  await page.getByRole('button', { name: '增大界面框架字号' }).click();
  await expect(page.getByRole('group', { name: '界面框架字号' })).toContainText('16px');
  await expect(
    page.locator('html').evaluate((element) => element.style.getPropertyValue('--ui-font-size')),
  ).resolves.toBe('16px');
  await expect(
    page
      .locator('html')
      .evaluate((element) => element.style.getPropertyValue('--workspace-font-size')),
  ).resolves.toBe('14px');
  await expect(
    page.locator('html').evaluate((element) => element.style.getPropertyValue('--log-font-size')),
  ).resolves.toBe('13px');
  await page.getByRole('button', { name: '增大工作台内容字号' }).click();
  await page.getByRole('button', { name: '增大工作台内容字号' }).click();
  await expect(page.getByRole('group', { name: '工作台内容字号' })).toContainText('16px');
  await expect(
    page.locator('html').evaluate((element) => element.style.getPropertyValue('--ui-font-size')),
  ).resolves.toBe('16px');
  await expect(
    page
      .locator('html')
      .evaluate((element) => element.style.getPropertyValue('--workspace-font-size')),
  ).resolves.toBe('16px');
  await page.getByRole('button', { name: '扩大导航栏宽度' }).click();
  await page.getByRole('button', { name: '扩大工作台内容宽度' }).click();
  await expect(
    page.locator('html').evaluate((element) => element.style.getPropertyValue('--sidebar-width')),
  ).resolves.toBe('312px');
  await expect(
    page.locator('html').evaluate((element) => element.style.getPropertyValue('--workspace-max')),
  ).resolves.toBe('1560px');
  await page.getByRole('button', { name: '转录工作台' }).click();
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
  ).resolves.toBe('98px');
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
  await page.getByRole('button', { name: /任务监控与记录/ }).click();
  await page
    .getByLabel('任务监控与历史记录')
    .getByRole('button', { name: /历史记录/ })
    .click();
  await expect(
    page
      .locator('.task-summary-card strong')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).resolves.toBe('24px');
  await expect(
    page
      .locator('.task-summary-card')
      .first()
      .evaluate((element) => getComputedStyle(element).padding),
  ).resolves.toBe('14px 18px');
  await page.getByRole('button', { name: '偏好设置' }).click();
  await page.getByRole('button', { name: '增大工作台内容字号' }).click();
  await page.getByRole('button', { name: '增大工作台内容字号' }).click();
  await expect(page.getByRole('group', { name: '工作台内容字号' })).toContainText('18px');
  await expect(page.getByRole('button', { name: '增大工作台内容字号' })).toBeDisabled();
  await page.getByRole('button', { name: '增大Worker 日志字号' }).click();
  await expect(page.getByRole('group', { name: 'Worker 日志字号' })).toContainText('14px');
  await page.getByRole('button', { name: '转录工作台' }).click();
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
  ).resolves.toBe('98px');
  await expect(page.locator('.output-panel')).toBeVisible();
  await expect(page.locator('.launch-card')).toBeVisible();
  await page.getByRole('button', { name: '粘贴 Windows 路径' }).click();
  await expect(page.getByLabel('执行前清单')).toContainText('媒体信息2 个媒体');
  await expect(page.getByRole('button', { name: '休眠' })).toHaveCount(0);
  const largeCardOverflow = await page
    .locator('.preset-panel:not(.subtitle-profile-panel) .preset-card, .preflight-item')
    .evaluateAll((cards) =>
      cards.map((card) => ({
        horizontal: card.scrollWidth - card.clientWidth,
        vertical: card.scrollHeight - card.clientHeight,
      })),
    );
  expect(Math.max(...largeCardOverflow.map((overflow) => overflow.horizontal))).toBeLessThanOrEqual(
    1,
  );
  expect(Math.max(...largeCardOverflow.map((overflow) => overflow.vertical))).toBeLessThanOrEqual(
    1,
  );
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
  await expect(page.getByRole('textbox', { name: '配置 JSON' })).toContainText('"uiFontSize": 16');
  await expect(page.getByRole('textbox', { name: '配置 JSON' })).toContainText(
    '"workspaceFontSize": 18',
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('settings-light.png') });
  await page.getByText('深色', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(250);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('settings-dark.png') });
  await page.getByText('浅色', { exact: true }).click();

  await page.getByRole('button', { name: /任务监控与记录/ }).click();
  await page
    .getByLabel('任务监控与历史记录')
    .getByRole('button', { name: /历史记录/ })
    .click();
  await expect(page.getByRole('heading', { name: '本机任务历史' })).toBeVisible();
  await expect(page.getByLabel('历史任务筛选')).toContainText('全部任务');
  const historyFilters = page.getByLabel('历史任务筛选');
  await expect(historyFilters.getByRole('button', { name: /全部任务/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await historyFilters.getByRole('button', { name: /已完成/ }).click();
  await expect(page.getByText('Product Interview 06.mkv', { exact: true })).toBeVisible();
  await expect(page.getByText('设计评审会议.m4a', { exact: true })).toHaveCount(0);
  await historyFilters.getByRole('button', { name: /全部任务/ }).click();
  await expect(page.locator('.task-card-progress').first()).toHaveText('63%');
  await expect(page.locator('.task-card-progress').first()).not.toContainText('进度');
  await expect(page.getByText('中文防幻觉 · 转录中 · TXT / MD')).toBeVisible();
  await expect(page.getByText('中文防幻觉 · GPU 转录中 · TXT / MD')).toHaveCount(0);
  await expect(page.getByText('英文转录 · 已完成 · TXT')).toBeVisible();
  await expect(page.getByText('稳定主语言')).toHaveCount(0);
  await expect(
    page
      .locator('.task-row')
      .first()
      .evaluate((card) => {
        const state = card.querySelector('.task-card-state')!.getBoundingClientRect();
        const progress = card.querySelector('.task-card-progress')!.getBoundingClientRect();
        return Math.abs(state.top + state.height / 2 - (progress.top + progress.height / 2));
      }),
  ).resolves.toBeLessThan(1);
  await expect(
    page.locator('.task-toolbar').evaluate((toolbar) => {
      const tops = Array.from(toolbar.children, (child) => child.getBoundingClientRect().top);
      return Math.max(...tops) - Math.min(...tops);
    }),
  ).resolves.toBeLessThan(1);
  await expect(
    historyFilters.evaluate((summary) => {
      const cards = summary.querySelectorAll('.task-summary-card');
      const first = cards[0]!.getBoundingClientRect();
      const second = cards[1]!.getBoundingClientRect();
      return Math.abs(second.left - first.right);
    }),
  ).resolves.toBeLessThan(1);
  await expect(
    page.locator('.task-history-shell').evaluate((shell) => {
      const summary = shell.querySelector('.task-summary-band')!.getBoundingClientRect();
      const panel = shell.querySelector('.task-panel.is-expanded')!.getBoundingClientRect();
      return {
        gap: Math.abs(panel.top - summary.bottom),
        overflow: getComputedStyle(shell).overflow,
        radius: Number.parseFloat(getComputedStyle(shell).borderTopLeftRadius),
      };
    }),
  ).resolves.toEqual({ gap: 0, overflow: 'hidden', radius: 20 });
  await expect(
    page
      .locator('.task-summary-card strong')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).resolves.toBe('26px');
  await expect(
    page
      .locator('.task-summary-card')
      .first()
      .evaluate((element) => getComputedStyle(element).padding),
  ).resolves.toBe('14px 18px');
  await page.getByRole('searchbox', { name: '搜索任务' }).fill('Interview');
  await expect(page.getByText('Product Interview 06.mkv', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除任务搜索' }).click();
  await expect(page.getByText('设计评审会议.m4a', { exact: true })).toBeVisible();
  const longTitleMetrics = await page
    .locator('.task-title-line strong')
    .first()
    .evaluate((title) => {
      title.textContent = '当你拥有一棵赛博粒子交互的圣诞树并继续附加很长的任务说明.mkv';
      const style = getComputedStyle(title);
      return {
        clientWidth: title.clientWidth,
        overflow: style.overflow,
        scrollWidth: title.scrollWidth,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    });
  expect(longTitleMetrics.scrollWidth).toBeGreaterThan(longTitleMetrics.clientWidth);
  expect(longTitleMetrics).toEqual(
    expect.objectContaining({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
  );
  await expect(page.locator('.task-panel.is-expanded .progress-track')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('tasks-light.png') });
});

test('opens an accessible task detail and output preview', async ({ page }) => {
  await page.getByRole('button', { name: /任务监控与记录/ }).click();
  await page
    .getByLabel('任务监控与历史记录')
    .getByRole('button', { name: /历史记录/ })
    .click();
  const retry = page.getByRole('button', { name: '重新转录 Product Interview 06.mkv' });
  await retry.click();
  await expect(page.getByRole('dialog', { name: '载入历史转录配置' })).toContainText(
    'Product Interview 06.mkv',
  );
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByText('Product Interview 06.mkv').click();
  await expect(page.getByRole('dialog', { name: 'Product Interview 06.mkv' })).toBeVisible();
  await expect(page.getByText('This is a local output preview')).toBeVisible();
  await page.getByRole('button', { name: '载入原配置' }).click();
  await expect(page.getByRole('dialog', { name: '载入历史转录配置' })).toBeVisible();
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
  await expect(monitor.getByLabel('当前任务日期版本与模型')).toContainText('2026-07-22 21:42');
  await expect(monitor.getByLabel('当前任务日期版本与模型')).toContainText('中文防幻觉');
  await expect(monitor.getByLabel('当前任务日期版本与模型')).toContainText('Large V3 Turbo');
  await expect(monitor.getByRole('progressbar')).toHaveCount(2);
  await expect(monitor.getByRole('progressbar').first()).toHaveAttribute('aria-valuenow', '63');
  await expect(
    page.evaluate(() => {
      const trend = document.querySelector('.performance-trend')!.getBoundingClientRect();
      const progress = document.querySelector('.task-progress-monitor')!.getBoundingClientRect();
      return Math.abs(trend.width - progress.width);
    }),
  ).resolves.toBeLessThan(1);

  await page.getByRole('button', { name: /任务监控与记录/ }).click();
  await page
    .getByLabel('任务监控与历史记录')
    .getByRole('button', { name: /任务监控/ })
    .click();
  await expect(page.getByRole('heading', { name: '设计评审会议.m4a' })).toBeVisible();
  await expect(page.locator('.task-monitor-source')).toContainText('多文件路径 · 2 个媒体文件');
  await expect(page.locator('.task-monitor-progress-card')).toHaveCount(2);
  await expect(page.locator('.task-monitor-support-grid')).toContainText('已生成 0 个文件');
  await expect(page.getByRole('heading', { name: '媒体文件进度' })).toBeVisible();
  await expect(page.locator('.task-monitor-stop')).toBeVisible();
  await expect(page.locator('.task-monitor-hero')).not.toContainText('GPU 转录中');
  await expect(
    page
      .locator('.task-monitor-meta > span')
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).resolves.toBeGreaterThanOrEqual(12);
  await page.waitForTimeout(220);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('task-monitor-redesign.png') });
  await page.locator('.task-monitor-stop').click();
  await expect(page.locator('.confirm-dialog')).toBeVisible();
  await page.locator('.confirm-dialog .secondary-button').click();
  await expect(page.locator('.confirm-dialog')).toHaveCount(0);
  await page
    .getByLabel('任务监控与历史记录')
    .getByRole('button', { name: /历史记录/ })
    .click();
  await expect(
    page
      .locator('.task-panel.is-expanded .task-list')
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
      ),
  ).resolves.toBe(4);
  await expect(page.locator('.task-panel.is-expanded .task-row')).toHaveCount(2);
  await expect(
    page
      .locator('.task-panel.is-expanded .task-row')
      .first()
      .evaluate((element) => getComputedStyle(element).borderRadius),
  ).resolves.toBe('18px');
  await expect(page.locator('.task-panel.is-expanded .progress-track')).toHaveCount(0);

  await page.getByRole('button', { name: '全部日期' }).click();
  const calendar = page.getByRole('dialog', { name: '按任务日期筛选' });
  await expect(calendar.getByRole('button', { name: '2026-07-22' })).toBeEnabled();
  await expect(calendar.getByRole('button', { name: '2026-07-20' })).toBeDisabled();
  await expect(
    calendar.evaluate((element) => parseFloat(getComputedStyle(element).width)),
  ).resolves.toBe(356);
  await expect(
    calendar
      .getByRole('button', { name: '2026-07-22' })
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).resolves.toBeGreaterThanOrEqual(12);
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
  await page.getByRole('button', { name: /任务监控与记录/ }).click();
  await page
    .getByLabel('任务监控与历史记录')
    .getByRole('button', { name: /任务监控/ })
    .click();
  await expect(page.getByRole('heading', { name: '设计评审会议.m4a' })).toBeVisible();
  await expect(page.getByText('任务已终止')).toBeVisible();

  await page.setViewportSize({ width: 1000, height: 900 });
  await page.getByRole('button', { name: /任务监控与记录/ }).click();
  await page
    .getByLabel('任务监控与历史记录')
    .getByRole('button', { name: /历史记录/ })
    .click();
  await expect(
    page
      .locator('.task-panel.is-expanded .task-list')
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
      ),
  ).resolves.toBe(3);
});

test('clears completed and abnormal history independently', async ({ page }) => {
  await page.getByRole('button', { name: /任务监控与记录/ }).click();
  await page
    .getByLabel('任务监控与历史记录')
    .getByRole('button', { name: /历史记录/ })
    .click();

  const clearCompleted = page.getByRole('button', { name: /清除历史 · 1/ });
  const clearAbnormal = page.getByRole('button', { name: /清除异常 · 0/ });
  await expect(clearCompleted).toBeEnabled();
  await expect(clearAbnormal).toBeDisabled();
  await clearCompleted.click();
  const confirmClearCompleted = page.getByRole('button', { name: /再次点击清除/ });
  await expect(confirmClearCompleted).toHaveAttribute('aria-pressed', 'true');
  await confirmClearCompleted.click();
  await expect(page.getByText('Product Interview 06.mkv')).toHaveCount(0);

  await page.getByRole('button', { name: /取消 设计评审会议.m4a/ }).click();
  const clearCancelled = page.getByRole('button', { name: /清除异常 · 1/ });
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
  await expect(page.locator('.output-format-copy')).toHaveCount(0);
  await expect(page.locator('.output-format-list .output-format-option')).toHaveCount(2);
  const srtOutput = page.getByRole('checkbox', { name: '生成 SRT 格式' });
  const txtOutput = page.getByRole('checkbox', { name: '生成 TXT 格式' });
  await expect(srtOutput).toBeChecked();
  await expect(txtOutput).not.toBeChecked();
  await txtOutput.check();
  await expect(txtOutput).toBeChecked();
  await expect(page.getByRole('button', { name: '开始生成 SRT + TXT' })).toHaveCount(1);
  await txtOutput.uncheck();
  await expect(page.getByRole('button', { name: '开始生成 SRT' })).toHaveCount(1);
  await expect(page.getByRole('spinbutton', { name: 'Compression ratio' })).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: 'Log probability' })).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: 'VAD 最短静音' })).toHaveCount(0);
  await page.getByRole('spinbutton', { name: '每行最多字符' }).fill('22');
  await expect(subtitlePanel.getByText('字幕自定义')).toBeVisible();
  await subtitlePanel.scrollIntoViewIfNeeded();
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('srt-profile-custom.png') });

  await page.getByRole('button', { name: '选择媒体文件' }).click();
  await expect(page.getByRole('button', { name: '开始生成 SRT' })).toBeEnabled();
  await page.getByRole('button', { name: '开始生成 SRT' }).click();
  await expect(page.getByRole('heading', { name: '性能监控' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /任务监控与记录/ }).locator('.nav-count'),
  ).toHaveText(/^[1-9]$/);
});

test('opens the independent Worker log workspace and exposes only the restored shortcut', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1728, height: 1080 });
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await expect(navigation.getByRole('button')).toHaveText([
    '转录工作台',
    '性能监控',
    /任务监控与记录/,
    'Worker 日志',
    '偏好设置',
  ]);
  await expect(page.getByText('CTRL + ENTER')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '打开 Mysimple 个人主页' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Worker 日志' }).click();
  await expect(page.getByRole('heading', { name: '实时诊断输出' })).toBeVisible();
  await expect(page.getByLabel('Worker 日志状态')).toContainText('BUFFER');
  await expect(page.getByLabel('Worker 日志状态').locator('article')).toHaveCount(4);
  await expect(page.getByRole('log').locator('code')).toHaveCount(3);
  await expect(page.getByRole('log').locator('.worker-log-source')).toHaveText([
    'WORKER',
    'MODEL',
    'TASK a1b2c3d4',
  ]);
  await expect(page.getByRole('log').locator('.worker-log-message').first()).toHaveText(
    'ready · PID 4242',
  );
  await expect(
    page
      .getByRole('log')
      .locator('.worker-log-message')
      .first()
      .evaluate((element) => getComputedStyle(element).textAlign),
  ).resolves.toBe('left');
  await expect(
    page.locator('.worker-logs-workspace').evaluate((element) => element.clientWidth),
  ).resolves.toBeGreaterThan(1200);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await expect(
    page
      .locator('.worker-log-stream')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).resolves.toBe('rgb(245, 245, 246)');
  await page.waitForTimeout(400);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('worker-logs.png') });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await expect(
    page
      .locator('.worker-log-stream')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).resolves.toBe('rgb(23, 25, 29)');
  await page.waitForTimeout(250);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('worker-logs-dark.png') });
});

test('keeps full-screen layout and typography personalization independent', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1728, height: 1080 });
  await page.getByRole('button', { name: '偏好设置' }).click();

  await expect(page.getByRole('heading', { name: '工作区尺寸' })).toBeVisible();
  await expect(page.getByRole('group', { name: '界面框架字号' })).toContainText('14px');
  await expect(page.getByRole('group', { name: '工作台内容字号' })).toContainText('14px');
  await expect(page.getByRole('group', { name: 'Worker 日志字号' })).toContainText('13px');
  await expect(page.getByRole('slider', { name: '工作台内容宽度滑杆' })).toHaveValue('1540');
  await expect(page.getByRole('slider', { name: '导航栏宽度滑杆' })).toHaveValue('304');
  await expect(
    page.locator('.settings-preference-grid').evaluate((element) => {
      const columns = getComputedStyle(element).gridTemplateColumns.split(' ');
      return columns.length;
    }),
  ).resolves.toBe(2);
  await expect(
    page.locator('.app-shell').evaluate((element) => getComputedStyle(element).gridTemplateColumns),
  ).resolves.toMatch(/^304px /);

  const resizeHandle = page.getByRole('separator', { name: '拖拽调整导航栏宽度' });
  const resizeBox = await resizeHandle.boundingBox();
  expect(resizeBox).not.toBeNull();
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + 220);
  await page.mouse.down();
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2 + 24, resizeBox!.y + 220, {
    steps: 4,
  });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.locator('html').evaluate((element) => element.style.getPropertyValue('--sidebar-width')),
    )
    .toBe('328px');

  await page.getByRole('spinbutton', { name: '导航栏宽度数值' }).fill('333');
  await page.getByRole('spinbutton', { name: '工作台内容宽度数值' }).fill('1655');
  await expect(
    page.locator('html').evaluate((element) => ({
      sidebar: element.style.getPropertyValue('--sidebar-width'),
      workspace: element.style.getPropertyValue('--workspace-max'),
    })),
  ).resolves.toEqual({ sidebar: '333px', workspace: '1655px' });
  await expect(
    page
      .locator('.dimension-number-input')
      .first()
      .evaluate((element) => {
        const input = element.querySelector('input')!.getBoundingClientRect();
        const unit = element.querySelector('small')!.getBoundingClientRect();
        return {
          inputRight: Math.round(input.right),
          unitLeft: Math.round(unit.left),
          unitWidth: Math.round(unit.width),
        };
      }),
  ).resolves.toEqual(
    expect.objectContaining({
      unitWidth: 28,
    }),
  );
  const dimensionCells = await page
    .locator('.dimension-number-input')
    .first()
    .evaluate((element) => {
      const input = element.querySelector('input')!.getBoundingClientRect();
      const unit = element.querySelector('small')!.getBoundingClientRect();
      return { inputRight: input.right, unitLeft: unit.left };
    });
  expect(dimensionCells.inputRight).toBeLessThanOrEqual(dimensionCells.unitLeft);
  const layoutCardWidth = await page.locator('.layout-settings-card').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(layoutCardWidth.scrollWidth - layoutCardWidth.clientWidth).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: '增大界面框架字号' }).click();
  await expect(
    page.locator('html').evaluate((element) => ({
      frame: element.style.getPropertyValue('--ui-font-size'),
      workspace: element.style.getPropertyValue('--workspace-font-size'),
      log: element.style.getPropertyValue('--log-font-size'),
    })),
  ).resolves.toEqual({ frame: '15px', workspace: '14px', log: '13px' });
  await expect(
    page
      .locator('.view-content')
      .evaluate((element) => getComputedStyle(element).getPropertyValue('--ui-font-size').trim()),
  ).resolves.toBe('14px');
  await page.getByRole('button', { name: '增大工作台内容字号' }).click();
  await expect(
    page.locator('html').evaluate((element) => ({
      frame: element.style.getPropertyValue('--ui-font-size'),
      workspace: element.style.getPropertyValue('--workspace-font-size'),
      log: element.style.getPropertyValue('--log-font-size'),
    })),
  ).resolves.toEqual({ frame: '15px', workspace: '15px', log: '13px' });
  await expect(
    page
      .locator('.view-content')
      .evaluate((element) => getComputedStyle(element).getPropertyValue('--ui-font-size').trim()),
  ).resolves.toBe('15px');

  await expect(
    page.getByRole('group', { name: '界面框架字号' }).evaluate((element) => {
      const output = element.querySelector('output')!.getBoundingClientRect();
      const value = element.querySelector('output strong')!.getBoundingClientRect();
      return Math.abs(output.top + output.height / 2 - (value.top + value.height / 2));
    }),
  ).resolves.toBeLessThanOrEqual(1);

  await expect(
    page.locator('.theme-sample.is-system').evaluate((element) => {
      const sample = element.getBoundingClientRect();
      const badge = element.querySelector('.theme-mode-badge')!.getBoundingClientRect();
      return badge.left < sample.left + sample.width / 2;
    }),
  ).resolves.toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('settings-personalization-fullscreen.png'),
  });

  await page.getByRole('combobox', { name: 'UI 字体' }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(
    page.getByRole('listbox').evaluate((element) => getComputedStyle(element).borderRadius),
  ).resolves.toBe('14px');
  await page.screenshot({
    path: testInfo.outputPath('settings-font-list.png'),
  });
  await page.getByRole('option', { name: '系统默认' }).click();

  await page.getByRole('button', { name: '打开自定义强调色编辑器' }).click();
  const colorEditor = page.getByRole('dialog', { name: '自定义强调色编辑器' });
  await expect(colorEditor).toBeVisible();
  await expect(
    colorEditor.evaluate((element) => getComputedStyle(element).borderRadius),
  ).resolves.toBe('17px');
  await page.screenshot({
    path: testInfo.outputPath('settings-custom-color.png'),
  });
});

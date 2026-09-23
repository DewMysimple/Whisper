import { expect, test } from '@playwright/test';

test('configures models and parameters through the shared entry, persists them and freezes a task', async ({
  page,
}) => {
  await page.goto('/');
  const entry = page.getByRole('button', { name: '前往参数调节' });
  await expect(entry).toHaveClass(/workspace-entry-card/);
  await expect(page.getByRole('button', { name: '粘贴 Windows 路径' })).toHaveClass(
    /workspace-entry-card/,
  );
  await entry.click();
  await expect(page.getByRole('heading', { name: '解码与采样' })).toBeVisible();
  await page.getByRole('combobox', { name: '参数所属识别模式' }).click();
  await page.getByRole('option', { name: '中文防幻觉' }).click();
  await page.getByLabel('束搜索宽度', { exact: true }).fill('7');
  await page.getByLabel('束搜索宽度', { exact: true }).press('Tab');
  await page.getByLabel('温度与回退序列', { exact: true }).fill('0, 0.3, 0.6');
  await page.getByLabel('温度与回退序列', { exact: true }).press('Tab');
  await page.getByLabel('语音起点阈值', { exact: true }).fill('0.65');
  await page.getByLabel('语音起点阈值', { exact: true }).press('Tab');
  await page.getByRole('combobox', { name: '初始提示词模式' }).click();
  await page.getByRole('option', { name: '手动设置' }).click();
  await page.getByLabel('初始提示词', { exact: true }).fill('Whisper\n中文术语');
  await page.getByLabel('初始提示词', { exact: true }).press('Tab');
  await page.getByRole('combobox', { name: '平均对数概率阈值模式' }).click();
  await page.getByRole('option', { name: '关闭检查' }).click();
  await page.getByLabel('束搜索宽度', { exact: true }).fill('0');
  await page.getByLabel('束搜索宽度', { exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toContainText('尚未应用');
  await page.getByLabel('束搜索宽度', { exact: true }).fill('7');
  await page.getByLabel('束搜索宽度', { exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page
    .getByLabel('模型与参数功能')
    .getByRole('button', { name: /模型切换/ })
    .click();
  await expect(page.getByRole('button', { name: '选择 Large V3 模型，未安装' })).toBeDisabled();
  await page.getByRole('button', { name: '选择 Medium 模型' }).click();
  await page
    .getByLabel('模型与参数功能')
    .getByRole('button', { name: /参数调节/ })
    .click();
  await expect(page.getByLabel('束搜索宽度', { exact: true })).toHaveValue('5');
  await page
    .getByLabel('模型与参数功能')
    .getByRole('button', { name: /模型切换/ })
    .click();
  await page.getByRole('button', { name: '选择 Large V3 Turbo 模型' }).click();
  await page
    .getByLabel('模型与参数功能')
    .getByRole('button', { name: /参数调节/ })
    .click();
  await expect(page.getByLabel('束搜索宽度', { exact: true })).toHaveValue('7');
  await page.reload();
  await page.getByRole('button', { name: '前往参数调节' }).click();
  await expect(page.getByLabel('初始提示词', { exact: true })).toHaveValue('Whisper\n中文术语');
  await expect(page.getByLabel('温度与回退序列', { exact: true })).toHaveValue('0, 0.3, 0.6');
  await page.getByRole('button', { name: '转录工作台', exact: true }).click();
  await page.getByRole('button', { name: '选择媒体文件' }).click();
  await page.getByRole('button', { name: /开始本地转录/ }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('whisper-subtitle.preview-state.v1')!);
        return state.tasks.find(
          (task: { draft?: { overrides: { beam_size?: number } } }) =>
            task.draft?.overrides.beam_size === 7,
        )?.draft;
      }),
    )
    .toMatchObject({
      modelId: 'large-v3-turbo',
      overrides: {
        beam_size: 7,
        temperature: [0, 0.3, 0.6],
        vad_threshold: 0.65,
        initial_prompt: 'Whisper\n中文术语',
        log_prob_threshold: null,
      },
    });
  expect(
    await page.evaluate(() => localStorage.getItem('whisper-subtitle.desktop-state.v1')),
  ).toBeNull();
});

test('model cards keep a stable hover surface and offer a separate directory action without exposing paths', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: /模型与参数/ }).click();
  const cards = page.locator('.config-model');
  await expect(cards).toHaveCount(6);
  await expect(page.locator('.config-model code')).toHaveCount(0);
  await expect(page.locator('.config-model-grid')).not.toContainText('models\\');
  await expect(page.locator('.config-model-choice.card-button')).toHaveCount(6);
  const unavailable = page.getByRole('button', { name: '选择 Tiny 模型，未安装' });
  await expect(unavailable).toBeDisabled();
  const selected = page.getByRole('button', { name: '选择 Large V3 Turbo 模型' });
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '打开 Tiny 模型目录' }).click();
  await expect(page.getByRole('status')).toContainText('桌面开发版');
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  const medium = page.getByRole('button', { name: '选择 Medium 模型' });
  const before = await medium.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await medium.hover();
  await page.waitForTimeout(200);
  const after = await medium.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      shadow: style.boxShadow,
      transform: style.transform,
      hovered: element.matches(':hover'),
    };
  });
  expect(after.box).toEqual(before);
  expect(after.shadow).toBe('none');
  expect(after.transform).toBe('none');
  expect(after.hovered).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('model-cards-light.png') });
  await page.getByRole('button', { name: '切换为深色主题' }).click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: testInfo.outputPath('model-cards-dark.png') });
});

test('configuration renders in both themes and preserves accessible editable fields at narrow widths', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '前往参数调节' }).click();
  for (const theme of ['light', 'dark']) {
    const toggle = page.getByRole('button', {
      name: theme === 'dark' ? '切换为深色主题' : '切换为浅色主题',
    });
    if (await toggle.count()) await toggle.click();
    for (const width of [1728, 1080, 760]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width === 1728) {
        await page.getByRole('combobox', { name: '任务类型' }).click();
        const taskChoice = page.getByRole('option', { name: '原声转录' });
        await expect(taskChoice).toBeVisible();
        expect(
          await taskChoice.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
            );
          }),
        ).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`configuration-menu-${theme}.png`) });
        await page.getByRole('combobox', { name: '任务类型' }).press('Escape');
      }
      expect(
        await page.locator('.configuration-view').evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      await page.getByLabel('束搜索宽度', { exact: true }).focus();
      await expect(page.getByLabel('束搜索宽度', { exact: true })).toBeFocused();
      await page
        .getByLabel('模型与参数功能')
        .getByRole('button', { name: /模型切换/ })
        .click();
      const cards = page.locator('.config-model');
      await expect(cards).toHaveCount(6);
      const geometry = await cards.evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            width: bounds.width,
            height: bounds.height,
            top: Math.round(bounds.top),
            overflow: element.scrollWidth - element.clientWidth,
          };
        }),
      );
      expect(
        Math.max(...geometry.map((item) => item.width)) -
          Math.min(...geometry.map((item) => item.width)),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.max(...geometry.map((item) => item.height)) -
          Math.min(...geometry.map((item) => item.height)),
      ).toBeLessThanOrEqual(1);
      expect(geometry.every((item) => item.overflow <= 1)).toBe(true);
      // The desktop shell keeps its 1080px minimum width even in a narrower viewport.
      expect(new Set(geometry.map((item) => item.top)).size).toBe(width === 1728 ? 2 : 3);
      expect(
        await page.locator('.configuration-view').evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      await page
        .getByLabel('模型与参数功能')
        .getByRole('button', { name: /参数调节/ })
        .click();
    }
    // Exercise the container breakpoint independently of the desktop shell's minimum width.
    await page.locator('.configuration-view').evaluate((element) => {
      (element as HTMLElement).style.width = '540px';
    });
    await page
      .getByLabel('模型与参数功能')
      .getByRole('button', { name: /模型切换/ })
      .click();
    const narrowGeometry = await page.locator('.config-model').evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height, left: bounds.left, top: bounds.top };
      }),
    );
    expect(new Set(narrowGeometry.map((item) => item.top)).size).toBe(6);
    expect(new Set(narrowGeometry.map((item) => item.left)).size).toBe(1);
    expect(new Set(narrowGeometry.map((item) => item.width)).size).toBe(1);
    expect(new Set(narrowGeometry.map((item) => item.height)).size).toBe(1);
    await page
      .getByLabel('模型与参数功能')
      .getByRole('button', { name: /参数调节/ })
      .click();
    expect(
      await page.locator('.configuration-view').evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await page.locator('.configuration-view').evaluate((element) => {
      (element as HTMLElement).style.removeProperty('width');
    });
  }
  await page.getByRole('button', { name: '转录工作台', exact: true }).click();
  await page.getByRole('button', { name: /任务监控与记录/ }).click();
  await page
    .getByLabel('任务监控与历史记录')
    .getByRole('button', { name: /历史记录/ })
    .click();
  await expect(page.locator('.task-card-created svg')).toHaveCount(0);
});

test('configuration shares the monitor navigation and performance panel presentation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /任务监控与记录/ }).click();
  const monitorNavigation = await page.locator('.task-workspace-switcher').evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderBottom, gap: style.gap };
  });
  await page.getByRole('button', { name: /性能监控/ }).click();
  const performancePanel = await page.locator('.performance-trend').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: style.border,
      radius: style.borderRadius,
      shadow: style.boxShadow,
    };
  });
  await page.getByRole('button', { name: /模型与参数/ }).click();
  const navigation = page.getByLabel('模型与参数功能');
  await expect(navigation.locator('.segmented-card')).toHaveCount(2);
  expect(
    await navigation.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderBottom, gap: style.gap };
    }),
  ).toEqual(monitorNavigation);
  expect(
    await page.locator('.config-workbench').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        border: style.border,
        radius: style.borderRadius,
        shadow: style.boxShadow,
      };
    }),
  ).toEqual(performancePanel);
  await navigation.getByRole('button', { name: /参数调节/ }).click();
  await expect(navigation.getByRole('button', { name: /参数调节/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.config-field')).toHaveCount(36);
});

test('switching model and parameter pages preserves horizontal alignment and rounded panel corners', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 2248, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: /模型与参数/ }).click();
  const navigation = page.getByLabel('模型与参数功能');
  const workbench = page.locator('.config-workbench');
  await expect(workbench.locator('.config-context')).toHaveCount(0);
  const modelLeft = await workbench.evaluate((element) => element.getBoundingClientRect().left);
  await navigation.getByRole('button', { name: /参数调节/ }).click();
  await expect(page.locator('.config-section')).toHaveCount(5);
  const parameterLeft = await workbench.evaluate((element) => element.getBoundingClientRect().left);
  expect(parameterLeft).toBeCloseTo(modelLeft, 1);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight))
    .toBe(true);
  await expect(page.locator('.config-section').first()).toHaveCSS('overflow', 'hidden');
  await page.screenshot({ path: testInfo.outputPath('parameter-panel-corners.png') });
  await page.getByRole('combobox', { name: '任务类型' }).click();
  await expect(page.locator('.config-section').first()).toHaveCSS('overflow', 'visible');
  await expect(page.getByRole('option', { name: '原声转录' })).toBeVisible();
  await page.getByRole('combobox', { name: '任务类型' }).press('Escape');
  const lastMode = page.getByRole('combobox', { name: '每窗口最大新 token 数模式' });
  await lastMode.click();
  await expect(page.locator('.config-section').nth(1)).toHaveCSS('overflow', 'visible');
  const defaultLimit = page.getByRole('option', { name: '模型默认上限' });
  await expect(defaultLimit).toBeVisible();
  expect(
    await defaultLimit.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
      );
    }),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('parameter-bottom-menu.png') });
  await lastMode.press('Escape');
  await navigation.getByRole('button', { name: /模型切换/ }).click();
  expect(await workbench.evaluate((element) => element.getBoundingClientRect().left)).toBeCloseTo(
    modelLeft,
    1,
  );
  await navigation.getByRole('button', { name: /参数调节/ }).click();
  const configuration = page.locator('.configuration-view');
  const lastField = page.locator('.config-section').nth(1).locator('.config-field').last();
  for (const width of [850, 540]) {
    await configuration.evaluate((element, nextWidth) => {
      (element as HTMLElement).style.width = `${nextWidth}px`;
    }, width);
    const corners = await lastField.evaluate((element) => {
      const style = getComputedStyle(element);
      return [parseFloat(style.borderBottomLeftRadius), parseFloat(style.borderBottomRightRadius)];
    });
    expect(corners[0]).toBeGreaterThan(0);
    expect(corners[1] > 0).toBe(width === 540);
  }
});

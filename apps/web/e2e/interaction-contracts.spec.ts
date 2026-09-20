import { expect, test, type Locator, type Page } from '@playwright/test';

async function holdWithoutMoving(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await target.hover();
  const before = await target.boundingBox();
  await page.mouse.down();
  try {
    const samples = await target.evaluate(async (element) => {
      const frames = [];
      for (let index = 0; index < 15; index++) {
        await new Promise(requestAnimationFrame);
        const rect = element.getBoundingClientRect();
        frames.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      }
      return frames;
    });
    for (const sample of samples) {
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(sample[key] - before![key])).toBeLessThan(0.2);
      }
    }
  } finally {
    await page.mouse.move(0, 0);
    await page.mouse.up();
  }
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`appearance preview animates hover and press without moving its hit area (${reducedMotion})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto('/');
    const openSettings = () =>
      page
        .getByRole('navigation', { name: '主导航' })
        .getByRole('button', { name: '偏好设置', exact: true })
        .click();
    await openSettings();
    const button = page.getByRole('button', { name: '开始本地转录', exact: true });
    const sampleFeedback = () =>
      button.evaluate(async (element) => {
        const frames = [];
        for (let index = 0; index < 16; index++) {
          await new Promise(requestAnimationFrame);
          const rect = element.getBoundingClientRect();
          frames.push({
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            transform: getComputedStyle(element.firstElementChild!).transform,
            shadow: getComputedStyle(element).boxShadow,
          });
        }
        return frames;
      });
    for (const theme of ['light', 'dark']) {
      const toggle = page.getByRole('button', {
        name: `切换为${theme === 'dark' ? '深色' : '浅色'}主题`,
      });
      if (await toggle.count()) await toggle.click();
      await button.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      const idle = (await sampleFeedback()).at(-1)!;
      // Hover the bottom edge: inner motion must never displace the native button.
      await page.mouse.move(idle.x + idle.width / 2, idle.y + idle.height - 0.25);
      const hover = await sampleFeedback();
      await page.mouse.down();
      const pressed = await sampleFeedback();
      expect(hover.at(-1)!.shadow).not.toBe(idle.shadow);
      expect(pressed.at(-1)!.shadow).not.toBe(hover.at(-1)!.shadow);
      for (const frame of [...hover, ...pressed]) {
        for (const key of ['x', 'y', 'width', 'height'] as const)
          expect(frame[key]).toBeCloseTo(idle[key], 1);
      }
      if (reducedMotion === 'reduce') {
        expect([...hover, ...pressed].every((frame) => frame.transform === 'none')).toBe(true);
      } else {
        expect(new Set(hover.map((frame) => frame.transform)).size).toBeGreaterThan(1);
        expect(new Set(pressed.map((frame) => frame.transform)).size).toBeGreaterThan(1);
        expect(pressed.at(-1)!.transform).not.toBe(hover.at(-1)!.transform);
      }
      await page.mouse.up();
      await expect(page.getByLabel('执行前清单')).toBeVisible();
      await openSettings();
    }
    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: '恢复外观默认值', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS('outline-style', 'solid');
    await page.keyboard.down('Space');
    const keyboardPress = (await sampleFeedback()).at(-1)!;
    if (reducedMotion === 'reduce') expect(keyboardPress.transform).toBe('none');
    else expect(keyboardPress.transform).not.toBe('none');
    await page.keyboard.up('Space');
    await expect(page.getByLabel('执行前清单')).toBeVisible();
  });

  test(`launch hover retains its edge hit area and gradient (${reducedMotion})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto('/');
    await page.getByRole('button', { name: '选择媒体文件', exact: true }).click();
    const launch = page.locator('.launch-submit');
    await expect(launch).toBeEnabled();
    await launch.scrollIntoViewIfNeeded();
    for (const theme of ['light', 'dark']) {
      const toggle = page.getByRole('button', {
        name: `切换为${theme === 'dark' ? '深色' : '浅色'}主题`,
      });
      if (await toggle.count()) await toggle.click();
      await launch.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      const before = await launch.boundingBox();
      const gradient = await launch.evaluate((e) => getComputedStyle(e).backgroundImage);
      expect(gradient).toContain('linear-gradient');
      // Exercise the bottom edge that used to move out from under the pointer.
      await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height - 0.25);
      const samples = await launch.evaluate(async (e) => {
        const values = [];
        for (let i = 0; i < 20; i++) {
          await new Promise(requestAnimationFrame);
          values.push({
            y: e.getBoundingClientRect().y,
            gradient: getComputedStyle(e).backgroundImage,
          });
        }
        return values;
      });
      for (const sample of samples) {
        expect(sample.y).toBeCloseTo(before!.y, 1);
        expect(sample.gradient).toBe(gradient);
      }
      await holdWithoutMoving(page, launch);
    }
  });
}

test('connected cards retain their edges through pointer and keyboard presses', async ({
  page,
}) => {
  await page.goto('/');
  await holdWithoutMoving(page, page.getByRole('button', { name: '前往版本与模型配置' }));
  await page.getByRole('button', { name: 'Worker 日志', exact: true }).click();
  for (const width of [1920, 900, 620]) {
    await page.setViewportSize({ width, height: 1080 });
    const cards = page.getByLabel('Worker 日志状态').getByRole('button');
    await holdWithoutMoving(page, cards.nth(1));
    const before = await cards.nth(1).boundingBox();
    await cards.nth(1).focus();
    await page.keyboard.down('Space');
    await expect(cards.nth(1)).toHaveCSS('transform', 'none');
    expect(await cards.nth(1).boundingBox()).toEqual(before);
    await page.keyboard.up('Space');
    await expect(page.getByRole('log')).toBeFocused();
    await expect(cards.nth(1)).not.toHaveAttribute('aria-pressed');
  }
  await page.getByRole('button', { name: /任务监控与记录/ }).click();
  await page
    .getByLabel('任务监控与历史记录')
    .getByRole('button', { name: /历史记录/ })
    .click();
  await holdWithoutMoving(page, page.locator('.task-workspace-switcher .segmented-card').last());
  await holdWithoutMoving(page, page.locator('.task-summary .segmented-card').first());
  await holdWithoutMoving(page, page.locator('.task-main').first());
});

test('history actions align and remain accessible across card widths and font sizes', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /任务监控与记录/ }).click();
  await page
    .getByLabel('任务监控与历史记录')
    .getByRole('button', { name: /历史记录/ })
    .click();
  for (const fontSize of [12, 18]) {
    await page.evaluate(
      (value) => document.documentElement.style.setProperty('--workspace-font-size', `${value}px`),
      fontSize,
    );
    for (const width of [1920, 1440, 1180, 900, 620]) {
      await page.setViewportSize({ width, height: 1080 });
      const headings = await page.locator('.task-card-heading').evaluateAll((elements) =>
        elements.map((heading) => {
          const title = heading.querySelector('.task-title-line strong')!;
          const time = heading.querySelector('time')!;
          const icon = heading.querySelector('.task-status')!;
          const extension = heading.querySelector('.task-title-extension')!;
          const titleRect = title.getBoundingClientRect();
          const timeRect = time.getBoundingClientRect();
          const iconRect = icon.getBoundingClientRect();
          return {
            titleLarger:
              parseFloat(getComputedStyle(title).fontSize) >
              parseFloat(getComputedStyle(time).fontSize),
            titleAligned:
              Math.abs(titleRect.y + titleRect.height / 2 - iconRect.y - iconRect.height / 2) < 1,
            timeBelow: timeRect.top >= Math.max(titleRect.bottom, iconRect.bottom) + 6,
            timeAligned: Math.abs(timeRect.left - iconRect.left) < 1,
            timeFits: time.scrollWidth <= time.clientWidth + 1,
            extensionFits: extension.getBoundingClientRect().right <= titleRect.right + 1,
          };
        }),
      );
      for (const heading of headings) expect(Object.values(heading).every(Boolean)).toBe(true);
      await expect(
        page.locator('.task-card-footer').getByText('模型', { exact: true }),
      ).toHaveCount(0);
      const geometry = await page.locator('.task-card-footer').evaluateAll((footers) =>
        footers.map((footer) => {
          const rect = footer.getBoundingClientRect();
          const model = footer.querySelector('.task-card-model')!.getBoundingClientRect();
          const actions = footer
            .querySelector('.task-card-footer-actions')!
            .getBoundingClientRect();
          const buttons = [...footer.querySelectorAll('button')].map((button) =>
            button.getBoundingClientRect(),
          );
          return {
            overflow: footer.scrollWidth - footer.clientWidth,
            aligned:
              rect.width > 270
                ? Math.abs(model.y + model.height / 2 - actions.y - actions.height / 2) < 1
                : model.bottom <= actions.top,
            buttonsFit: buttons.every(
              (b) =>
                b.width >= 32 &&
                b.left >= rect.left &&
                b.right <= rect.right &&
                b.bottom <= rect.bottom,
            ),
            centers: buttons.map((b) => b.y + b.height / 2),
          };
        }),
      );
      for (const item of geometry) {
        expect(item.overflow).toBeLessThanOrEqual(1);
        expect(item.aligned).toBe(true);
        expect(item.buttonsFit).toBe(true);
        expect(Math.max(...item.centers) - Math.min(...item.centers)).toBeLessThan(1);
      }
    }
  }
  const card = page.locator('.task-row.is-completed').first();
  const remove = card.getByRole('button', { name: /删除.*任务记录/ });
  await remove.focus();
  await page.keyboard.press('Space');
  await expect(remove).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(remove).toHaveAttribute('aria-pressed', 'false');
  await card
    .locator('.task-card-footer-actions')
    .getByRole('button', { name: /查看.*详情/ })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭任务详情' })).toBeFocused();
});

import { expect, test, type Page } from '@playwright/test';

async function openHistory(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /任务监控与记录/ })
    .click();
  await page
    .getByLabel('任务监控与历史记录')
    .getByRole('button', { name: /历史记录/ })
    .click();
}

test('calendar remains hit-testable beyond the history manager and supports keyboard entry', async ({
  page,
}) => {
  await openHistory(page);
  await page.getByRole('button', { name: '全部日期', exact: true }).click();
  const calendar = page.getByRole('dialog', { name: '按任务日期筛选' });
  await expect(calendar.locator('button[aria-pressed]:enabled').first()).toBeFocused();
  const reset = calendar.getByRole('button', { name: '全部日期' });
  await reset.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      reset.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return target === element || element.contains(target);
      }),
    )
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(calendar).toHaveCount(0);
  await expect(page.getByRole('button', { name: '全部日期', exact: true })).toBeFocused();
});

test('task styles respond at their owning rule without shell or important overrides', async ({
  page,
}) => {
  await openHistory(page);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    const changes = await page.evaluate(() => {
      const cases = [
        { selector: '.task-history-config-cell small', property: 'font-size', value: '17px' },
        { selector: '.task-history-config-cell strong', property: 'font-size', value: '16px' },
        { selector: '.task-row', property: 'padding-top', value: '7px' },
      ];
      const rules = [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
      return cases.map(({ selector, property, value }) => {
        const matches = rules.filter((rule) =>
          rule.selectorText
            .split(',')
            .map((s) => s.trim())
            .includes(selector),
        );
        if (matches.length !== 1)
          throw new Error(`${selector}: expected one owner, got ${matches.length}`);
        const rule = matches[0]!;
        const original = rule.style.cssText;
        rule.style.setProperty(property, value);
        const actual = getComputedStyle(document.querySelector(selector)!).getPropertyValue(
          property,
        );
        rule.style.cssText = original;
        return { actual, expected: value };
      });
    });
    for (const change of changes) expect(change.actual).toBe(change.expected);
  }
});

test('task workbench honors content width and keeps responsive cards intact', async ({ page }) => {
  await openHistory(page);
  for (const [width, columns] of [
    [1920, 4],
    [1180, 3],
    [900, 2],
    [620, 1],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator('.task-list')).toHaveCSS('display', 'grid');
    const geometry = await page.locator('.task-list').evaluate((list) => {
      const cards = [...list.querySelectorAll('.task-row')];
      return {
        columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
        overflow: cards.map((card) => card.scrollWidth - card.clientWidth),
        widths: cards.map((card) => card.getBoundingClientRect().width),
      };
    });
    expect(geometry.columns).toBe(columns);
    expect(geometry.overflow.every((value) => value <= 1)).toBe(true);
    expect(Math.max(...geometry.widths) - Math.min(...geometry.widths)).toBeLessThan(1);
  }
  await page.setViewportSize({ width: 1920, height: 1000 });
  for (const width of [1300, 1450]) {
    await page.evaluate(
      (width) => document.documentElement.style.setProperty('--workspace-max', `${width}px`),
      width,
    );
    await expect
      .poll(() =>
        page.locator('.tasks-view').evaluate((element) => {
          const parent = element.parentElement!;
          const style = getComputedStyle(parent);
          return Math.round(
            element.getBoundingClientRect().width +
              parseFloat(style.paddingLeft) +
              parseFloat(style.paddingRight),
          );
        }),
      )
      .toBe(width);
  }
});

test('navigation shares the management surface and cards keep an inset facts grid and a single footer row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openHistory(page);
  await expect(page.locator('.task-history-manager .task-workspace-switcher')).toBeVisible();
  await expect(page.locator('.task-workspace-switcher .segmented-card')).toHaveCount(2);
  await expect(page.locator('.task-summary .segmented-card')).toHaveCount(4);
  const footer = page.locator('.task-card-footer').nth(1);
  const model = await footer.locator('.task-card-model').boundingBox();
  const actions = await footer.locator('.task-card-footer-actions').boundingBox();
  expect(Math.abs(model!.y + model!.height / 2 - actions!.y - actions!.height / 2)).toBeLessThan(1);
  await page.getByRole('button', { name: '查看 Product Interview 06.mkv 详情' }).first().click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByLabel('任务概要').locator('dt')).toHaveCount(6);
  const preview = await detail.locator('.preview-section').boundingBox();
  const parameters = await detail.locator('.parameter-snapshot').boundingBox();
  expect(preview!.y).toBeLessThan(parameters!.y);
  await expect
    .poll(() => detail.evaluate((e) => e.scrollWidth - e.clientWidth))
    .toBeLessThanOrEqual(1);
});

test('topbar folds without losing its expanded height and the settings preview opens the workbench', async ({
  page,
}) => {
  await page.goto('/');
  const topbar = page.locator('.topbar');
  const height = (await topbar.boundingBox())!.height;
  await page.getByRole('button', { name: '收起顶栏' }).click();
  await expect(topbar).toHaveCSS('height', '16px');
  await expect(page.getByRole('button', { name: '展开顶栏' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '偏好设置' })
    .click();
  await page.getByRole('button', { name: '开始本地转录' }).click();
  await expect(page.getByLabel('执行前清单')).toBeVisible();
  await page.getByRole('button', { name: '展开顶栏' }).click();
  await expect(topbar).toHaveCSS('height', `${height}px`);
  await page.getByRole('button', { name: 'Worker 日志', exact: true }).click();
  const cards = page.getByLabel('Worker 日志状态').getByRole('button');
  for (let index = 0; index < 4; index++) {
    await cards.nth(index).click();
    await expect(cards.nth(index)).not.toHaveAttribute('aria-pressed');
    await expect(page.getByRole('log')).toBeFocused();
  }
});

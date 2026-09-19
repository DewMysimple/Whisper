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

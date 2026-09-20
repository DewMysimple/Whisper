import { expect, test } from '@playwright/test';

test('summary and diagnostic typography respect independent preferences across themes and widths', async ({
  page,
}) => {
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: '主导航' });
  for (const theme of ['light', 'dark']) {
    const toggle = page.getByRole('button', {
      name: theme === 'dark' ? '切换为深色主题' : '切换为浅色主题',
    });
    if (await toggle.count()) await toggle.click();
    for (const width of [1728, 1080, 760, 620]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [workspaceSize, logSize] of [
        [12, 10],
        [14, 13],
        [18, 16],
      ]) {
        await page.evaluate(
          ({ workspaceSize, logSize }) => {
            document.documentElement.style.setProperty(
              '--workspace-font-size',
              `${workspaceSize}px`,
            );
            document.documentElement.style.setProperty('--log-font-size', `${logSize}px`);
          },
          { workspaceSize, logSize },
        );
        await navigation.getByRole('button', { name: /任务监控与记录/ }).click();
        const values = page.locator('.task-monitor-support-grid .summary-value');
        await expect(values).toHaveCount(2);
        for (const value of await values.all()) {
          await expect(value).toHaveCSS('font-size', `${Math.max(14, workspaceSize!)}px`);
          await expect(value).toHaveCSS('font-weight', '600');
        }
        const families = await values.evaluateAll((elements) =>
          elements.map((e) => getComputedStyle(e).fontFamily),
        );
        expect(families[0]).toBe(families[1]);
        await navigation.getByRole('button', { name: 'Worker 日志', exact: true }).click();
        const message = page.locator('.worker-log-message').nth(1);
        await expect(message).toHaveCSS('font-size', `${logSize}px`);
        await expect(message).toHaveCSS('font-family', families[0]!);
        await expect(message).toHaveCSS('user-select', 'text');
        await expect(message).toHaveCSS('white-space', 'pre-wrap');
        const geometry = await page.locator('.worker-log-stream').evaluate((stream) => ({
          overflow: stream.scrollWidth - stream.clientWidth,
          columns: [...stream.querySelectorAll('.worker-log-message')].map(
            (e) => e.getBoundingClientRect().left,
          ),
        }));
        expect(geometry.overflow).toBeLessThanOrEqual(1);
        expect(new Set(geometry.columns).size).toBe(1);
      }
    }
  }
  await navigation.getByRole('button', { name: '偏好设置', exact: true }).click();
  await expect(page.locator('.appearance-preview-canvas .diagnostic-text')).toHaveCSS(
    'font-size',
    '16px',
  );
});

test('diagnostic owners control the rendered rules and long messages stay readable', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Worker 日志', exact: true }).click();
  const results = await page.evaluate(() => {
    const rules = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
    return [
      { selector: '.diagnostic-text', property: 'font-size', value: '15px' },
      { selector: '.summary-value', property: 'font-weight', value: '400' },
      { selector: '.worker-log-timestamp small', property: 'font-size', value: '14px' },
    ].map(({ selector, property, value }) => {
      const matches = rules.filter((rule) => rule.selectorText === selector);
      if (matches.length !== 1) throw new Error(`${selector} has ${matches.length} owners`);
      const rule = matches[0]!;
      const original = rule.style.cssText;
      rule.style.setProperty(property, value);
      const actual = getComputedStyle(document.querySelector(selector)!).getPropertyValue(property);
      rule.style.cssText = original;
      return { actual, expected: value };
    });
  });
  for (const result of results) expect(result.actual).toBe(result.expected);
  await page.setViewportSize({ width: 620, height: 1000 });
  const message = page.locator('.worker-log-message').last();
  const text = 'D:\\媒体\\' + '很长的路径与错误信息'.repeat(35) + '\n  保留缩进\t与空白';
  await message.evaluate((element, text) => (element.textContent = text), text);
  expect(await message.textContent()).toBe(text);
  const dimensions = await message.evaluate((e) => ({
    overflow: e.scrollWidth - e.clientWidth,
    height: e.clientHeight,
    line: parseFloat(getComputedStyle(e).lineHeight),
  }));
  expect(dimensions.overflow).toBeLessThanOrEqual(1);
  expect(dimensions.height).toBeGreaterThan(dimensions.line * 2);
  await expect(page.getByRole('button', { name: '复制全部' })).toBeEnabled();
});

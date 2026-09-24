import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test(`output locations use a continuous settings layout and keep paths inline (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    const panel = page.getByRole('region', { name: '文件输出', exact: true });
    const readOutputLayout = () =>
      panel.evaluate((element) => {
        const panelBox = element.getBoundingClientRect();
        // Ignore browser floating-point noise below one hundredth of a CSS pixel.
        const pixels = (value: number) => Math.round(value * 100) / 100;
        return {
          height: pixels(panelBox.height),
          sections: Array.from(
            element.querySelectorAll('.output-sheet-section, .output-format-list'),
            (section) => {
              const box = section.getBoundingClientRect();
              return { top: pixels(box.top - panelBox.top), height: pixels(box.height) };
            },
          ),
        };
      });
    const choices = panel.getByRole('group', { name: '文件输出策略' });
    const description = panel.locator('.output-location-description');
    await expect(choices.getByRole('button')).toHaveText(['跟随', '文件夹', '自定义']);
    await expect(choices.getByRole('button', { name: '跟随', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(description).toHaveText('直接保存在每个媒体文件所在目录');
    const requiredHint = panel.getByRole('status');
    const txtFormat = panel.getByRole('checkbox', { name: '生成 TXT 格式' });
    const selectedLayout = await readOutputLayout();
    await txtFormat.uncheck();
    await expect(requiredHint).toHaveText('至少选择一种需要生成的文件格式。');
    expect(await readOutputLayout()).toEqual(selectedLayout);
    const headingBox = await panel.locator('.output-section-heading').boundingBox();
    const hintBox = await requiredHint.boundingBox();
    const formatsBox = await panel.locator('.output-format-list').boundingBox();
    expect(hintBox!.y).toBeGreaterThan(headingBox!.y + headingBox!.height);
    expect(hintBox!.y + hintBox!.height).toBeLessThan(formatsBox!.y);
    await panel.locator('.output-file-types').screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(`required-format-${theme}.png`),
    });
    await txtFormat.check();
    await expect(requiredHint).toHaveCount(0);
    expect(await readOutputLayout()).toEqual(selectedLayout);
    await choices.getByRole('button', { name: '文件夹', exact: true }).click();
    await page.getByRole('checkbox', { name: '生成 Markdown 格式' }).check();
    await expect(description).toHaveText('在每个媒体目录中创建 Text 文件夹');
    await expect(page.getByLabel('执行前清单')).toContainText('媒体旁的分类文件夹');
    await panel.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(`folders-${theme}.png`),
    });
    await page.locator('.subtitle-profile-panel .preset-card').first().click();
    await page.getByRole('checkbox', { name: '生成 SRT 格式' }).check();
    await page.getByRole('checkbox', { name: '生成 TXT 格式' }).check();
    await expect(description).toHaveText('在每个媒体目录中创建 Text / SRT 文件夹');
    await page.getByRole('checkbox', { name: '生成 TXT 格式' }).uncheck();
    await expect(description).toHaveText('在每个媒体目录中创建 SRT 文件夹');
    await choices.getByRole('button', { name: '自定义', exact: true }).click();
    await expect(description).toHaveText('D:\\字幕项目\\2026-07');
    await expect(panel.locator('.output-path-value, .output-copy-panel')).toHaveCount(0);
    await expect(panel.locator('.output-sheet-section')).toHaveCount(4);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('whisper-subtitle.preview-state.v1') ?? '{}')
              .preferences?.output.mode,
        ),
      )
      .toBe('custom');
    const longPath = `D:\\课程资料\\${'归档与转录输出\\'.repeat(16)}最终输出`;
    await page.evaluate((rootDirectory) => {
      const key = 'whisper-subtitle.preview-state.v1';
      const saved = JSON.parse(localStorage.getItem(key)!);
      saved.preferences.output.rootDirectory = rootDirectory;
      saved.preferences.workspaceFontSize = 18;
      localStorage.setItem(key, JSON.stringify(saved));
    }, longPath);
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.reload();
    await expect(description).toHaveText(longPath);
    const largerTextLayout = await readOutputLayout();
    const srtFormat = panel.getByRole('checkbox', { name: '生成 SRT 格式' });
    await srtFormat.uncheck();
    await expect(requiredHint).toBeVisible();
    expect(await readOutputLayout()).toEqual(largerTextLayout);
    await srtFormat.check();
    await expect(requiredHint).toHaveCount(0);
    expect(await readOutputLayout()).toEqual(largerTextLayout);
    const pathLayout = await description.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      overflow: getComputedStyle(element).textOverflow,
      clipped: element.scrollWidth > element.clientWidth,
    }));
    expect(pathLayout.height).toBeCloseTo(pathLayout.lineHeight, 1);
    expect(pathLayout.overflow).toBe('ellipsis');
    expect(pathLayout.clipped).toBe(true);
    await expect(choices.getByRole('button', { name: '自定义', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const overflows = await panel
      .locator('.output-sheet-section')
      .evaluateAll((cards) => cards.map((card) => card.scrollWidth - card.clientWidth));
    expect(Math.max(...overflows)).toBeLessThanOrEqual(1);
    const sourceBox = await page.locator('.source-panel').boundingBox();
    const outputBox = await panel.boundingBox();
    expect(outputBox!.y).toBeGreaterThanOrEqual(sourceBox!.y + sourceBox!.height);
    expect(outputBox!.width).toBeGreaterThan(700);
    const buttons = await panel
      .locator('.output-location-options > button, .output-conflict-options > button')
      .evaluateAll((items) =>
        items.map((item) => ({
          height: item.getBoundingClientRect().height,
          radius: getComputedStyle(item).borderRadius,
        })),
      );
    expect(new Set(buttons.map((button) => button.height)).size).toBe(1);
    expect(new Set(buttons.map((button) => button.radius)).size).toBe(1);
    await panel.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(`custom-long-path-${theme}.png`),
    });
    await choices.getByRole('button', { name: '跟随', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(description).toHaveText('直接保存在每个媒体文件所在目录');
    await expect(choices.getByRole('button', { name: '跟随', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
}

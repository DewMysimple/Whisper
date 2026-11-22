import { expect, test, type Locator, type Page } from '@playwright/test';

import { INTERFACE_SIZE_PRESETS } from '../src/state/appearancePreferences';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

const longChinesePath = `D:\\字幕项目\\${'同一访谈项目的归档和转录输出\\'.repeat(14)}校对稿`;
const longEnglishPath = `D:\\${'UnbrokenEnglishDirectoryName'.repeat(15)}`;

async function selectCustomOutput(page: Page) {
  await page.getByRole('button', { name: '自定义', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('whisper-subtitle.preview-state.v1') ?? '{}').preferences
            ?.output.mode,
      ),
    )
    .toBe('custom');
}

function readGeometry(panel: Locator, showNativeScrollbar = false) {
  return panel.evaluate((element, showScrollbar) => {
    const scroller = element.querySelector<HTMLElement>('.launch-unified')!;
    const previousOverflow = scroller.style.overflowY;
    if (showScrollbar) scroller.style.overflowY = 'scroll';
    const origin = element.getBoundingClientRect();
    const geometry = Array.from(
      element.querySelectorAll(
        '.launch-heading, .preflight-status, .preflight-item, .preflight-icon, .preflight-key, .launch-action-dock, .preflight-sources-link, .launch-submit',
      ),
      (item) => {
        const box = item.getBoundingClientRect();
        return [box.x - origin.x, box.y - origin.y, box.width, box.height].map(
          (value) => Math.round(value * 100) / 100,
        );
      },
    );
    scroller.style.overflowY = previousOverflow;
    return geometry;
  }, showNativeScrollbar);
}

const configurations = [
  {
    name: '偏小',
    fonts: INTERFACE_SIZE_PRESETS.small,
    width: 1440,
    localWidth: 320,
    path: longEnglishPath,
    minLines: 1,
  },
  {
    name: '平衡',
    fonts: INTERFACE_SIZE_PRESETS.balanced,
    width: 1440,
    localWidth: 0,
    path: longChinesePath,
    minLines: 1,
  },
  {
    name: '偏大',
    fonts: INTERFACE_SIZE_PRESETS.large,
    width: 1920,
    localWidth: 0,
    path: longChinesePath,
    minLines: 2,
  },
  {
    name: '自定义',
    fonts: { uiFontSize: 18, workspaceFontSize: 17, logFontSize: 14, workspaceWidth: 1500 },
    width: 1180,
    localWidth: 360,
    path: longEnglishPath,
    minLines: 2,
  },
] as const;

for (const { name, fonts, width, localWidth, path, minLines } of configurations) {
  test(`fits preflight text within the fixed cards (${name})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await selectCustomOutput(page);

    const panel = page.locator('.launch-card');
    const checklist = page.getByLabel('执行前清单');
    const output = checklist.getByRole('button', { name: '前往输出策略配置' });
    const outputPath = output.locator('.preflight-output-details .preflight-multiline');
    const applyPath = async (directory: string) => {
      await page.evaluate(
        ({ directory, fonts }) => {
          const key = 'whisper-subtitle.preview-state.v1';
          const saved = JSON.parse(localStorage.getItem(key)!);
          Object.assign(saved.preferences, fonts, {
            selectedModelId: 'qwen3-asr-1.7b',
            selectedPresetId: 'en_v2',
            parameterProfiles: { 'qwen3-asr-1.7b:en_v2': { initial_prompt: 'Glossary' } },
          });
          saved.preferences.output.rootDirectory = directory;
          localStorage.setItem(key, JSON.stringify(saved));
        },
        { directory, fonts },
      );
      await page.reload();
      await expect(outputPath).toHaveText(directory);
      if (localWidth > 0) {
        await checklist.evaluate((element, size) => {
          element.style.inlineSize = `${size}px`;
        }, localWidth);
      }
    };

    await applyPath('D:\\字幕');
    const before = await readGeometry(panel);
    const beforeWithScrollbar = await readGeometry(panel, true);
    await applyPath(path);
    expect([before, beforeWithScrollbar]).toContainEqual(await readGeometry(panel));
    await expect(outputPath).toHaveAttribute('title', path);
    await expect(output).toHaveAccessibleDescription(`TXT，${path}，覆盖`);
    const pathLayout = await outputPath.evaluate((element) => {
      const style = getComputedStyle(element);
      const height = element.getBoundingClientRect().height;
      return {
        lineCount: Math.round(height / Number.parseFloat(style.lineHeight)),
        lineClamp: Number(style.webkitLineClamp),
        scrollHeight: element.scrollHeight,
        height,
      };
    });
    expect(pathLayout.lineCount).toBeGreaterThanOrEqual(minLines);
    expect(pathLayout.lineCount).toBe(pathLayout.lineClamp);
    expect(pathLayout.scrollHeight).toBeGreaterThan(pathLayout.height);

    const model = checklist.getByRole('button', { name: '前往版本与模型配置' });
    await expect(model).toHaveAccessibleDescription(
      '英文防幻觉 · 自定义参数，Qwen3-ASR 1.7B · 本地离线处理',
    );
    const modelTitle = model.locator('strong');
    await expect(modelTitle).toHaveCSS('text-overflow', 'ellipsis');
    await expect(modelTitle).toHaveCSS('white-space', 'nowrap');
    if (name === '偏小') {
      expect(
        await modelTitle.evaluate((element) => element.scrollWidth > element.clientWidth),
      ).toBe(true);
      const modelDetails = model.locator('.preflight-multiline');
      await expect(modelDetails).toHaveCSS('-webkit-line-clamp', '1');
      expect(
        await modelDetails.evaluate((element) => element.scrollHeight > element.clientHeight),
      ).toBe(true);
    }
    for (const label of ['覆盖', '跳过', '重命名']) {
      const policySettings = page.getByRole('group', { name: '同名冲突策略' });
      await policySettings.getByRole('button', { name: label, exact: true }).click();
      const policy = output.getByText(label, { exact: true });
      await expect(policy).toBeVisible();
      const policyLayout = await policy.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const card = element.closest('.preflight-item')!.getBoundingClientRect();
        return {
          fits: rect.bottom <= card.bottom && rect.right <= card.right,
          oneLine:
            Math.abs(rect.height - Number.parseFloat(getComputedStyle(element).lineHeight)) < 1,
          overflow: element.scrollWidth - element.clientWidth,
        };
      });
      expect(policyLayout).toEqual({ fits: true, oneLine: true, overflow: 0 });
    }

    const cardOverflows = await checklist
      .locator('.preflight-item')
      .evaluateAll((cards) =>
        cards.map((card) => [
          card.scrollWidth - card.clientWidth,
          card.scrollHeight - card.clientHeight,
        ]),
      );
    expect(cardOverflows).toEqual(Array.from({ length: 4 }, () => [0, 0]));
    await panel.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('preflight-overflow.png'),
    });
  });
}

test('keeps the scrollbar width only where the former wrapping needed it', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route('**/*.css', async (route) => {
    const response = await route.fetch();
    // Give the headless browser a non-overlay scrollbar like the packaged WebView.
    const classicScrollbar = `
      .launch-unified { scrollbar-width: auto; }
      .launch-unified::-webkit-scrollbar { width: 10px; }
    `;
    await route.fulfill({ response, body: (await response.text()) + classicScrollbar });
  });
  await page.goto('/');
  await selectCustomOutput(page);
  const panel = page.locator('.launch-card');
  const scroller = panel.locator('.launch-unified');
  const pathText = panel.locator('.preflight-output-details .preflight-multiline');
  const readOverflow = () => scroller.evaluate((item) => item.scrollHeight - item.clientHeight);
  const showPath = async (directory: string) => {
    await page.evaluate((path) => {
      const key = 'whisper-subtitle.preview-state.v1';
      const saved = JSON.parse(localStorage.getItem(key)!);
      saved.preferences.output.rootDirectory = path;
      localStorage.setItem(key, JSON.stringify(saved));
    }, directory);
    await page.reload();
    await expect(pathText).toHaveText(directory);
  };

  const normalGeometry = await readGeometry(panel);
  const previousOverflowGeometry = await readGeometry(panel, true);
  expect(previousOverflowGeometry).not.toEqual(normalGeometry);
  await showPath(`D:\\${'UnbrokenEnglishDirectoryName'.repeat(3)}`);
  expect(await readGeometry(panel)).toEqual(normalGeometry);
  expect(await pathText.evaluate((item) => item.scrollHeight > item.clientHeight)).toBe(true);

  await showPath(longChinesePath);
  await expect(scroller).toHaveCSS('scrollbar-gutter', 'stable');
  expect(await readGeometry(panel)).toEqual(previousOverflowGeometry);
  expect(await readOverflow()).toBe(0);
  await expect(panel.locator('.preflight-conflict-policy')).toBeVisible();

  await page.getByRole('button', { name: '跟随', exact: true }).click();
  await expect(scroller).toHaveCSS('scrollbar-gutter', 'auto');
  expect(await readGeometry(panel)).toEqual(normalGeometry);
  expect(await readOverflow()).toBe(0);
});

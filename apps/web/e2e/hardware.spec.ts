import { expect, test } from '@playwright/test';

test('hardware settings persist, validate and remain frozen in the submitted task', async ({
  page,
}) => {
  await page.goto('/');
  const open = () =>
    page
      .getByRole('navigation', { name: '主导航' })
      .getByRole('button', { name: '硬件优化', exact: true })
      .click();
  await open();
  await expect(page.getByLabel('执行设备', { exact: true })).toBeEnabled();
  await expect(page.getByText('演示硬件', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /CPU 推理.*CPU · INT8/ }).click();
  await expect(page.getByRole('combobox', { name: '执行设备' })).toHaveText('CPU');
  await expect(page.getByRole('combobox', { name: '计算精度' })).toHaveText('INT8');
  await page.getByRole('combobox', { name: '计算精度' }).click();
  await expect(page.getByRole('option', { name: /^FLOAT16 ·/ })).toBeDisabled();
  await page.getByRole('combobox', { name: '计算精度' }).press('Escape');
  await expect(page.getByLabel('GPU 设备', { exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'CPU 线程策略' }).click();
  await page.getByRole('option', { name: '手动指定' }).click();
  await page.getByLabel('CPU 推理线程数', { exact: true }).fill('257');
  await page.getByLabel('CPU 推理线程数', { exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toContainText('尚未应用');
  await page.getByLabel('CPU 推理线程数', { exact: true }).fill('2');
  await page.getByLabel('CPU 推理线程数', { exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('whisper-subtitle.preview-state.v1') ?? '{}').preferences
            ?.executionOptions,
      ),
    )
    .toMatchObject({ device: 'cpu', compute_type: 'int8', cpu_threads: 2 });
  await page.reload();
  await open();
  await expect(page.getByLabel('CPU 推理线程数', { exact: true })).toHaveValue('2');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '转录工作台', exact: true })
    .click();
  await page.getByRole('button', { name: '选择媒体文件' }).click();
  await page.getByRole('button', { name: /开始本地转录/ }).click();
  await page.getByRole('button', { name: '继续转录', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('whisper-subtitle.preview-state.v1')!).tasks.find(
            (task: { draft?: { execution?: { cpu_threads?: number } } }) =>
              task.draft?.execution?.cpu_threads === 2,
          )?.hardware,
      ),
    )
    .toEqual({ device: 'cpu', deviceIndex: 0, computeType: 'int8', cpuThreads: 2 });
  await open();
  await page.getByRole('button', { name: /节省显存/ }).click();
  await expect(page.getByRole('combobox', { name: '计算精度' })).toHaveText('INT8_FLOAT16');
  await page.getByRole('button', { name: '恢复硬件默认' }).click();
  await expect(page.getByRole('combobox', { name: '执行设备' })).toHaveText('自动选择');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('whisper-subtitle.preview-state.v1')!);
        return {
          settings: state.preferences.executionOptions,
          task: state.tasks.find(
            (task: { draft?: { execution?: { cpu_threads?: number } } }) =>
              task.draft?.execution?.cpu_threads === 2,
          )?.draft.execution,
        };
      }),
    )
    .toEqual({
      settings: {},
      task: { device: 'cpu', device_index: 0, compute_type: 'int8', cpu_threads: 2 },
    });
});

test('hardware workbench follows both themes and keeps controls inside its panels', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '硬件优化', exact: true })
    .click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    for (const width of [1728, 1080, 760]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.getByLabel('执行设备', { exact: true })).toBeEnabled();
      await expect(page.locator('.view-content')).toHaveCSS('opacity', '1');
      expect(
        await page
          .locator('.optimization-panel, .optimization-field')
          .evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth + 1)),
      ).toBe(true);
      await page.getByRole('combobox', { name: '执行设备' }).click();
      const cpuChoice = page.getByRole('option', { name: 'CPU', exact: true });
      await expect(cpuChoice).toBeVisible();
      expect(
        await cpuChoice.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return element.contains(
            document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
          );
        }),
      ).toBe(true);
      if (theme === 'light' && width === 1728) {
        await page.screenshot({ path: testInfo.outputPath('hardware-menu-open.png') });
      }
      await page.getByRole('combobox', { name: '执行设备' }).press('Escape');
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`hardware-${theme}-${width}.png`),
      });
    }
  }
});

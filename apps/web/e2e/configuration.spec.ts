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
  await page.getByLabel('参数所属识别模式').selectOption('cn2');
  await page.getByLabel('束搜索宽度', { exact: true }).fill('7');
  await page.getByLabel('束搜索宽度', { exact: true }).press('Tab');
  await page.getByLabel('温度与回退序列', { exact: true }).fill('0, 0.3, 0.6');
  await page.getByLabel('温度与回退序列', { exact: true }).press('Tab');
  await page.getByLabel('语音起点阈值', { exact: true }).fill('0.65');
  await page.getByLabel('语音起点阈值', { exact: true }).press('Tab');
  await page.getByLabel('初始提示词模式').selectOption('manual');
  await page.getByLabel('初始提示词', { exact: true }).fill('Whisper\n中文术语');
  await page.getByLabel('初始提示词', { exact: true }).press('Tab');
  await page.getByLabel('平均对数概率阈值模式').selectOption('auto');
  await page.getByLabel('束搜索宽度', { exact: true }).fill('0');
  await page.getByLabel('束搜索宽度', { exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toContainText('尚未应用');
  await page.getByLabel('束搜索宽度', { exact: true }).fill('7');
  await page.getByLabel('束搜索宽度', { exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '模型切换', exact: true }).click();
  await expect(
    page.locator('.config-model').filter({ hasText: 'Large V3' }).filter({ hasText: '精度优先' }),
  ).toBeDisabled();
  await page.locator('.config-model').filter({ hasText: 'Medium' }).click();
  await page.getByRole('button', { name: '参数调节', exact: true }).click();
  await expect(page.getByLabel('束搜索宽度', { exact: true })).toHaveValue('5');
  await page.getByRole('button', { name: '模型切换', exact: true }).click();
  await page.locator('.config-model').filter({ hasText: 'Large V3 Turbo' }).click();
  await page.getByRole('button', { name: '参数调节', exact: true }).click();
  await expect(page.getByLabel('束搜索宽度', { exact: true })).toHaveValue('7');
  await page.reload();
  await page.getByRole('button', { name: '前往参数调节' }).click();
  await expect(page.getByLabel('初始提示词', { exact: true })).toHaveValue('Whisper\n中文术语');
  await expect(page.getByLabel('温度与回退序列', { exact: true })).toHaveValue('0, 0.3, 0.6');
  await page.getByRole('button', { name: '返回转录工作台' }).click();
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

test('configuration renders in both themes and preserves accessible editable fields at narrow widths', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '前往参数调节' }).click();
  for (const theme of ['light', 'dark']) {
    const toggle = page.getByRole('button', {
      name: theme === 'dark' ? '切换为深色主题' : '切换为浅色主题',
    });
    if (await toggle.count()) await toggle.click();
    for (const width of [1728, 1080, 760]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.locator('.configuration-view').evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      await page.getByLabel('束搜索宽度', { exact: true }).focus();
      await expect(page.getByLabel('束搜索宽度', { exact: true })).toBeFocused();
    }
  }
  await page.getByRole('button', { name: '返回转录工作台' }).click();
  await page.getByRole('button', { name: /任务监控与记录/ }).click();
  await page
    .getByLabel('任务监控与历史记录')
    .getByRole('button', { name: /历史记录/ })
    .click();
  await expect(page.locator('.task-card-created svg')).toHaveCount(0);
});

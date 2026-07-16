import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('MOCK BRIDGE')).toBeVisible();
});

test('creates a task from the complete desktop workspace path', async ({ page }) => {
  await page.getByRole('button', { name: '选择多个文件' }).click();
  await expect(page.getByText('P20-核心语法-整数类型.mp4', { exact: true })).toBeVisible();

  const beamSize = page.getByRole('spinbutton', { name: 'Beam size' });
  await beamSize.fill('6');
  await expect(page.getByText('派生自定义')).toBeVisible();

  await page.getByText('Markdown', { exact: true }).click();
  await page.getByRole('button', { name: /媒体旁 \/ Text/ }).click();
  await page.getByRole('button', { name: /开始本地转录/ }).click();
  await expect(page.getByText('2 个输入来源')).toBeVisible();
});

test('supports keyboard navigation, theme and configuration export', async ({ page }) => {
  await page.keyboard.press('Control+3');
  await expect(page.getByRole('heading', { name: '桌面外观' })).toBeVisible();

  await page.getByRole('combobox', { name: '主题' }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '生成导出配置' }).click();
  await expect(page.getByRole('textbox', { name: '配置 JSON' })).toContainText('schemaVersion');

  await page.keyboard.press('Control+2');
  await expect(page.getByRole('heading', { name: '任务队列与本地历史' })).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索任务' }).fill('Interview');
  await expect(page.getByText('Product Interview 06.mkv')).toBeVisible();
});

test('opens an accessible task detail and output preview', async ({ page }) => {
  await page.keyboard.press('Control+2');
  await page.getByText('Product Interview 06.mkv').click();
  await expect(page.getByRole('dialog', { name: 'Product Interview 06.mkv' })).toBeVisible();
  await expect(page.getByText('This is a local output preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

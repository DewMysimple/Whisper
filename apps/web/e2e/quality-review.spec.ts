import { expect, test } from '@playwright/test';

test('reviews a persisted suspicious segment with keyboard actions and source association', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /切换为.+色主题/ }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('whisper-subtitle.preview-state.v1')))
    .not.toBeNull();
  await page.evaluate(() => {
    const key = 'whisper-subtitle.preview-state.v1';
    const data = JSON.parse(localStorage.getItem(key)!);
    data.tasks = [
      {
        ...data.tasks[0],
        id: 'quality-review',
        title: 'review.wav',
        status: 'completed',
        modelId: 'large-v3-turbo',
        sourceCount: 1,
        outputs: [],
        draft: undefined,
        mediaStates: [
          {
            path: 'D:\\Media\\review.wav',
            status: 'completed',
            progress: 100,
            stage: '完成',
            elapsedSeconds: 1,
            qualityDiagnostics: {
              detectedLanguage: 'zh',
              languageProbability: null,
              segmentCount: 1,
              fallbackSegmentCount: 1,
              maxTemperature: 0.4,
              lowConfidenceCount: 1,
              segments: [
                {
                  index: 0,
                  start: 1.125,
                  end: 2.75,
                  text: '待人工复核的原话',
                  temperature: 0.4,
                  avgLogProbability: -1.2,
                  compressionRatio: 1,
                  noSpeechProbability: 0,
                  reasons: ['low_log_probability'],
                },
              ],
            },
          },
        ],
      },
    ];
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: /任务监控与记录/ })
    .click();
  await page
    .getByLabel('任务监控与历史记录')
    .getByRole('button', { name: /历史记录/ })
    .click();
  await page.getByRole('button', { name: '查看 review.wav 详情' }).first().click();
  const segment = page.locator('.quality-segment');
  await expect(segment).toContainText('低平均概率');
  await expect(segment).toContainText('源媒体：review.wav');
  await expect(segment).toContainText('00:00:01,125 --> 00:00:02,750');
  for (const [name, feedback] of [
    ['复制片段', '已复制片段文本'],
    ['复制时间', '已复制起止时间'],
    ['定位媒体', '已定位源媒体'],
  ]) {
    await segment.getByRole('button', { name }).focus();
    await page.keyboard.press('Enter');
    await expect(segment.getByRole('status')).toHaveText(feedback!);
  }
  await page.setViewportSize({ width: 620, height: 900 });
  await expect
    .poll(() => page.getByRole('dialog').evaluate((e) => e.scrollWidth - e.clientWidth))
    .toBeLessThanOrEqual(1);
});

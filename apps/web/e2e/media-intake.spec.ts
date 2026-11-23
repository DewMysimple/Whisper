import { expect, test } from '@playwright/test';

import type { InputInspectionProgress, InputSource } from '../src/contracts/desktop';

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (message: unknown) => void>();
    let nextId = 0;
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback(callback: (message: unknown) => void) {
          const id = nextId++;
          callbacks.set(id, callback);
          return id;
        },
        async invoke(
          command: string,
          args: {
            event: string;
            handler: number;
            paths: string[];
            onProgress: { onmessage: (progress: InputInspectionProgress) => void };
          },
        ) {
          switch (command) {
            case 'plugin:event|listen':
              window.addEventListener(args.event, (event) => {
                callbacks.get(args.handler)?.({
                  event: args.event,
                  id: args.handler,
                  payload: (event as CustomEvent).detail,
                });
              });
              return args.handler;
            case 'get_host_status':
              return { state: 'ready', pid: 1, launchKind: 'test', error: null };
            case 'get_worker_logs':
              return [];
            case 'get_power_capabilities':
              return { shutdown: false };
            case 'get_power_action_status':
              return { state: 'idle', action: null, executeAtEpochMs: null, error: null };
            case 'worker_environment':
            case 'worker_metrics':
            case 'worker_health':
              return { data: { result: null } };
            case 'inspect_inputs': {
              const sources = args.paths.map((path, index): InputSource => ({
                id: `drag-${index}`,
                path,
                kind: 'file',
                origin: 'drop',
                valid: true,
                durationSeconds: 8,
              }));
              args.onProgress.onmessage({ index: 0, phase: 'discovered', item: sources[0]! });
              return new Promise<InputSource[]>((resolve) => {
                window.addEventListener('test:complete-media-inspection', () => resolve(sources), {
                  once: true,
                });
              });
            }
            default:
              throw new Error(`Unexpected Tauri call in media intake test: ${command}`);
          }
        },
      },
    });
  });
});

for (const width of [1440, 1180]) {
  test(`keeps the full intake frame stable through native drag and inspection (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByText('LOCAL IPC · READY', { exact: true })).toBeVisible();
    const source = page.getByRole('region', { name: '输入来源', exact: true });
    const dropZone = source.getByRole('group', { name: '媒体拖放与选择区域' });
    const status = dropZone.getByRole('status');
    const launch = page.getByRole('button', { name: '开始本地转录' });
    const progress = dropZone.getByRole('list', { name: '媒体检查进度' });
    const readFrame = () =>
      source.evaluate((panel) => {
        const zone = panel.querySelector('.drop-zone')!;
        const border = getComputedStyle(zone);
        const measure = (element: Element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x: x + window.scrollX, y: y + window.scrollY, width, height };
        };
        return {
          panel: measure(panel),
          zone: measure(zone),
          clipboard: measure(panel.querySelector('.clipboard-intake')!),
          outline: [border.borderTopWidth, border.borderTopStyle, border.borderTopLeftRadius],
        };
      });

    await expect(status).toHaveText('添加本地媒体');
    await expect(dropZone).toHaveCSS('border-top-style', 'dashed');
    await expect(page.locator('.view-content')).toHaveCSS('transform', 'none');
    const emptyFrame = await readFrame();
    const emptyBorder = await dropZone.evaluate((item) => getComputedStyle(item).borderTopColor);
    const position = await dropZone.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x: x + width / 2, y: y + height / 2 };
    });
    const paths = Array.from(
      { length: 12 },
      (_, index) => String.raw`D:\媒体\采访 ${index + 1}.wav`,
    );
    const drag = (phase: 'enter' | 'over' | 'drop') =>
      page.evaluate(
        ({ phase, paths, position }) => {
          window.dispatchEvent(
            new CustomEvent(`tauri://drag-${phase}`, { detail: { paths, position } }),
          );
        },
        { phase, paths, position },
      );

    await drag('enter');
    await expect(status).toHaveText('松开以添加本地媒体');
    await expect(dropZone).not.toHaveCSS('border-top-color', emptyBorder);
    expect(await readFrame()).toEqual(emptyFrame);
    await drag('over');
    await expect(status).toHaveText('松开以添加本地媒体');
    expect(await readFrame()).toEqual(emptyFrame);

    await drag('drop');
    await expect(status).toHaveText('正在检查 12 项媒体来源…');
    await expect(progress.getByText('检查中 · 读取时长')).toBeVisible();
    await expect(progress.getByRole('listitem')).toHaveCount(paths.length);
    await expect(launch).toBeDisabled();
    expect(await readFrame()).toEqual(emptyFrame);
    expect(
      await progress.evaluate((list) => {
        const frame = list.closest('.drop-zone')!.getBoundingClientRect();
        const bounds = list.getBoundingClientRect();
        return bounds.bottom <= frame.bottom && list.scrollHeight > list.clientHeight;
      }),
    ).toBe(true);
    await dropZone.getByRole('button', { name: '添加文件夹' }).focus();
    await page.keyboard.press('Tab');
    await expect(progress).toBeFocused();
    await page.keyboard.press('End');
    await expect.poll(() => progress.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
    expect(await readFrame()).toEqual(emptyFrame);

    await page.evaluate(() => window.dispatchEvent(new Event('test:complete-media-inspection')));
    await expect(progress).toHaveCount(0);
    await expect(status).toHaveText('添加本地媒体');
    await expect(launch).toBeEnabled();
    await expect(page.getByRole('button', { name: '查看 12 个媒体文件进度' })).toBeEnabled();
    expect(await readFrame()).toEqual(emptyFrame);
  });
}

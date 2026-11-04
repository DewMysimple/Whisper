// Explicit Edge measurement of the existing stringify + localStorage write path.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const requireWeb = createRequire(resolve(root, 'apps/web/package.json'));
const { chromium } = requireWeb('@playwright/test');
const output = process.argv[2];
if (!output) throw new Error('Pass a new output directory');
await mkdir(resolve(output), { recursive: false });
const vite = resolve(dirname(requireWeb.resolve('vite/package.json')), 'bin/vite.js');
const server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', '4179', '--strictPort'],
  { cwd: resolve(root, 'apps/web'), windowsHide: true, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch('http://127.0.0.1:4179')).ok) break; } catch {}
    if (i > 100 || server.exitCode !== null) throw new Error('Preview did not start');
    await new Promise((done) => setTimeout(done, 100));
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4179');
  await page.getByRole('button', { name: /切换为.+色主题/ }).click();
  await page.waitForFunction(() => localStorage.getItem('whisper-subtitle.preview-state.v1') !== null);
  const result = await page.evaluate(() => {
    const persisted = JSON.parse(localStorage.getItem('whisper-subtitle.preview-state.v1'));
    const task = persisted.tasks.find((item) => item.draft) ?? persisted.tasks[0];
    const scenarios = [];
    for (const diagnosticCount of [0, 50]) {
      const tasks = Array.from({ length: 100 }, (_, i) => ({ ...task, id: `synthetic-history-${i}`,
        mediaStates: diagnosticCount ? [{ path: 'fixture.wav', status: 'completed', progress: 100,
          stage: 'done', elapsedSeconds: 1, qualityDiagnostics: { segments: Array.from({ length: diagnosticCount }, (_, j) => ({
            index: j, start: j, end: j + 1, text: '中'.repeat(160), reasons: ['low_log_probability'],
            temperature: .4, avgLogProbability: -1.2, compressionRatio: 2.4, noSpeechProbability: .5,
          })) } }] : task.mediaStates }));
      const payload = { schemaVersion: 1, preferences: persisted.preferences, tasks };
      const samples = [];
      let text;
      for (let i = 0; i < 200; i++) {
        const start = performance.now();
        text = JSON.stringify(payload);
        localStorage.setItem('temporary-persistence-measurement', text);
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      scenarios.push({ tasks: 100, syntheticDiagnosticSegmentsPerTask: diagnosticCount,
        payloadBytes: new TextEncoder().encode(text).length, runs: samples.length,
        medianMs: samples[100], p95Ms: samples[190], maxMs: samples[199] });
    }
    localStorage.removeItem('temporary-persistence-measurement');
    return { scope: 'synthetic-browser-synchronous-save-only', userAgent: navigator.userAgent, scenarios };
  });
  await writeFile(resolve(output, 'persistence.json'), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally {
  await browser?.close();
  server.kill();
}

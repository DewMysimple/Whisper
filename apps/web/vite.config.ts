import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'WHISPER_SUBTITLE_BUILD_');
  return {
    define: {
      __FRONTEND_BUILD__: JSON.stringify({
        revision: env.WHISPER_SUBTITLE_BUILD_REVISION ?? null,
        builtAt: env.WHISPER_SUBTITLE_BUILD_TIME ?? null,
      }),
    },
    plugins: [react()],
    clearScreen: false,
    server: {
      host: '127.0.0.1',
      port: 1420,
      strictPort: true,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },
    test: {
      // History fixtures assert local clock values in this explicit test zone.
      env: { TZ: 'Asia/Shanghai' },
      maxWorkers: 2,
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.ts',
      css: true,
    },
  };
});

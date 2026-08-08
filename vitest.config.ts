import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * The unit suite runs against the source, not the bundle, so it needs the same
 * `@/` alias Vite gives the app. Tauri's IPC is stubbed in `tests/setup.ts`
 * because nothing here is allowed to touch a real window or a real database.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/**/*.d.ts'],
    },
  },
});

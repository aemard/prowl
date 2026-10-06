import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;
const strict = { lines: 95, branches: 95, functions: 95, statements: 95 };

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  define: {
    'import.meta.env.VITE_GITHUB_API_URL': JSON.stringify('https://api.github.com'),
    'import.meta.env.VITE_GITHUB_WEB_URL': JSON.stringify('https://github.com'),
    'import.meta.env.VITE_GITHUB_CLIENT_ID': JSON.stringify('test-client-id'),
    'import.meta.env.VITE_BUILD_MODE': JSON.stringify('test'),
  },
  test: {
    environment: 'happy-dom',
    include: [
      'src/**/*.test.{ts,tsx}',
      'tests/unit/**/*.test.{ts,tsx}',
      'scripts/**/*.test.{ts,mjs}',
    ],
    setupFiles: ['tests/unit/setup.ts'],
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/test/**',
        'src/sidepanel/main.tsx',
        'src/background/index.ts',
      ],
      reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        'src/lib/diff/**': strict,
        'src/lib/github/**': strict,
        'src/lib/storage/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  },
});

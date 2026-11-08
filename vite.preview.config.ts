import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/preview'),
  plugins: [preact()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      'node:util': resolve(import.meta.dirname, 'src/preview/equality.ts'),
    },
  },
  define: {
    'process.env.PROWL_E2E_PORT': 'undefined',
    'import.meta.env.VITE_GITHUB_API_URL': JSON.stringify('https://mock.prowl.test'),
    'import.meta.env.VITE_GITHUB_WEB_URL': JSON.stringify('https://github.com'),
    'import.meta.env.VITE_GITHUB_CLIENT_ID': JSON.stringify(''),
    'import.meta.env.VITE_BUILD_MODE': JSON.stringify('development'),
  },
  build: { outDir: resolve(import.meta.dirname, 'dist-preview'), emptyOutDir: true },
  server: { host: 'localhost', port: 5174, strictPort: true },
});

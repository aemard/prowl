import { resolve } from 'node:path';
import { crx, type ManifestV3Export } from '@crxjs/vite-plugin';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { createManifest } from './src/manifest.ts';

const root = import.meta.dirname;
const manifest = createManifest('development');
manifest.name = 'Prowl (development)';
manifest.background = { service_worker: 'background/index.ts', type: 'module' };
// Vite injects styles and loads modules over localhost during development.
// Production and E2E continue to use the strict CSP in createManifest.
manifest.content_security_policy = {
  extension_pages: [
    "default-src 'self'",
    "script-src 'self' http://localhost:5173",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://avatars.githubusercontent.com",
    "connect-src 'self' https://api.github.com https://github.com http://localhost:5173 ws://localhost:5173",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; '),
};

export default defineConfig({
  root: resolve(root, 'src'),
  publicDir: resolve(root, 'public'),
  envDir: root,
  plugins: [preact(), crx({ manifest: manifest as ManifestV3Export })],
  resolve: { alias: { '@': resolve(root, 'src') } },
  define: {
    'import.meta.env.VITE_GITHUB_API_URL': JSON.stringify('https://api.github.com'),
    'import.meta.env.VITE_GITHUB_WEB_URL': JSON.stringify('https://github.com'),
    'import.meta.env.VITE_GITHUB_CLIENT_ID': JSON.stringify(
      process.env.PROWL_GITHUB_CLIENT_ID ?? '',
    ),
    'import.meta.env.VITE_BUILD_MODE': JSON.stringify('development'),
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    hmr: { host: 'localhost', port: 5173, clientPort: 5173 },
  },
  build: { outDir: resolve(root, 'dist-dev'), emptyOutDir: true, target: 'chrome116' },
});

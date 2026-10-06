import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';
import { type BuildMode, createManifest, E2E_ORIGIN } from './src/manifest.ts';

const root = import.meta.dirname;

function manifestPlugin(mode: BuildMode): Plugin {
  return {
    name: 'prowl-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(createManifest(mode), null, 2)}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const buildMode: BuildMode = mode === 'e2e' || mode === 'development' ? mode : 'production';
  const e2e = buildMode === 'e2e';
  const defines = {
    VITE_GITHUB_API_URL: e2e ? E2E_ORIGIN : 'https://api.github.com',
    VITE_GITHUB_WEB_URL: e2e ? E2E_ORIGIN : 'https://github.com',
    VITE_GITHUB_CLIENT_ID: e2e ? 'e2e-client-id' : (process.env.PROWL_GITHUB_CLIENT_ID ?? ''),
    VITE_BUILD_MODE: buildMode,
  };

  return {
    root: resolve(root, 'src'),
    publicDir: resolve(root, 'public'),
    envDir: root,
    base: '/',
    plugins: [preact(), manifestPlugin(buildMode)],
    resolve: {
      alias: { '@': resolve(root, 'src') },
    },
    define: Object.fromEntries(
      Object.entries(defines).map(([key, value]) => [
        `import.meta.env.${key}`,
        JSON.stringify(value),
      ]),
    ),
    build: {
      outDir: resolve(root, e2e ? 'dist-e2e' : 'dist'),
      emptyOutDir: true,
      target: 'chrome116',
      manifest: true,
      sourcemap: buildMode === 'development',
      minify: buildMode !== 'development',
      modulePreload: { polyfill: false },
      rolldownOptions: {
        input: {
          sidepanel: resolve(root, 'src/sidepanel/index.html'),
          background: resolve(root, 'src/background/index.ts'),
        },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        },
      },
    },
  };
});

import { defineConfig } from 'astro/config';

// GitHub Pages project site: https://aemard.github.io/prowl/
export default defineConfig({
  site: 'https://aemard.github.io',
  base: '/prowl/',
  output: 'static',
  trailingSlash: 'always',
  // The shared tokens and the page styles are about 13 KB: inline them, so the first paint
  // does not wait for a second request.
  build: { inlineStylesheets: 'always' },
  devToolbar: { enabled: false },
});

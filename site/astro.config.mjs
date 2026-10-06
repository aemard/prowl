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
  // Astro's whitespace compression drops the space between a line break and an inline tag
  // ("Choose<strong>..."); the pages are small and served gzipped, so keep the source spacing.
  compressHTML: false,
  // The Markdown pages only hold shell commands: no highlighter, no inline colors.
  markdown: { syntaxHighlight: false },
  devToolbar: { enabled: false },
});

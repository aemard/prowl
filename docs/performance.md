# Performance

## Budgets (enforced)

`pnpm size` (`scripts/check-size.mjs`) checks gzipped sizes against `perf-budget.json` after
every build, in `pnpm verify` and in CI. It follows each entry's static imports, so lazy chunks
do not count toward first load.

| Budget | Limit (gzip) | v1.0.0 |
|---|---|---|
| Side panel JS loaded at startup | 60 KB | 39.1 KB |
| Side panel CSS | 12 KB | 5.8 KB |
| Service worker JS | 30 KB | 11.6 KB |
| Whole extension | 400 KB | 66.8 KB |

`tests/e2e/performance.spec.ts` opens the side panel three times with a cached snapshot and
asserts that the first list render (`performance.mark('prowl:list-rendered')`, measured from
navigation start) happens within **150 ms** in at least one run, and that opening the panel
makes no GitHub call. Locally (Chromium 141, sandbox VM): 56–80 ms.

## How it stays fast

- **Render from cache.** The service worker persists the snapshot; the panel hydrates its
  signals from `chrome.storage.local` and renders before any network request. Polling never runs
  in the panel.
- **Small runtime.** Preact 10 and @preact/signals are the only runtime dependencies; no CSS
  framework, no icon font (inline SVG icons).
- **Lazy chunks.** Settings and a card's expanded part (checks, reviewers, actions, dialogs) are
  separate chunks loaded on first use (`src/sidepanel/components/lazy.tsx`). The service worker
  never uses dynamic `import()`.
- **Cheap polling.** One GraphQL search per enabled section (~4 points per 50 PRs, pages of 25), merge facts only for PRs that changed, check counts
  instead of check lists, details fetched only on expand.

## Measuring

```sh
pnpm build && pnpm size                       # bundle budgets
pnpm build:e2e && pnpm exec playwright test tests/e2e/performance.spec.ts   # prints render times
```

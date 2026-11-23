# Performance

## Budgets (enforced)

`pnpm size` (`scripts/check-size.mjs`) checks gzipped sizes against `perf-budget.json` after
every build, in `pnpm verify` and in CI, and prints each size next to its limit. It follows each
entry's static imports, so lazy chunks do not count toward first load.

| Budget | Limit (gzip) |
|---|---|
| Side panel JS loaded at startup | 60 KB |
| Side panel CSS | 12 KB |
| Service worker JS | 36 KB |
| Whole extension (every file of `dist/`, gzipped) | 400 KB |

`tests/e2e/performance.spec.ts` opens the side panel three times with a cached snapshot. The best
run must render the list (`performance.mark('prowl:list-rendered')`, from navigation start)
within **150 ms**, and opening the panel on a fresh list must make no GitHub call. On a list
older than a minute the panel asks the service worker for a poll and renders when it lands.

## How it stays fast

- **Render from cache.** The service worker stores the snapshot; the panel hydrates its signals
  from `chrome.storage.local` and renders before any network request. The panel never polls.
- **Small runtime.** Preact and `@preact/signals` are the only runtime dependencies: no CSS
  framework, no icon font (inline SVG).
- **Lazy chunks.** Settings, a card's expanded part (with the detail query), stack rows and the
  turn summary load on first use (`src/sidepanel/components/lazy.tsx`). The service worker never
  uses `import()`.
- **Cheap polling.** One GraphQL search per searched section (pages of 25), merge facts only for
  PRs that changed, check counts instead of check lists, details only on expand. Figures:
  [architecture.md, "Query cost"](architecture.md#query-cost).

## Measuring

```sh
pnpm build && pnpm size
pnpm build:e2e && pnpm exec playwright test tests/e2e/performance.spec.ts   # prints render times
```

# Prowl — guide for agents

Prowl is a client-only MV3 Chrome extension: a side panel that tracks your GitHub pull
requests, notifies on changes and lets you act on them. No backend, no telemetry.

Read `docs/architecture.md` (module map, data flow, contracts) and `docs/decisions.md`
before changing anything structural. `src/lib/model.ts` is the shared contract.

## Commands

| Command | What |
|---|---|
| `pnpm verify` | Everything CI runs: Biome, file lengths, types, unit + coverage gates, build, size budget, all E2E. CI runs it on every push; it must be green before merging. |
| `pnpm verify:changed` | Before every commit: `verify:fast`, build and size budget. E2E runs in CI only; run one spec locally (`pnpm build:e2e && pnpm exec playwright test <spec> --reporter=dot`) only while writing it or to chase a CI failure. |
| `pnpm verify:fast` | Lint + file lengths + types + unit tests (inner loop) |
| `pnpm lines` | File length gate (`scripts/check-file-size.mjs`) and its shrink-only baseline |
| `pnpm test` / `pnpm coverage` | Vitest (coverage gates: 80% global, 95% `src/lib/diff` and `src/lib/github`) |
| `pnpm e2e` | Builds `dist-e2e/` then runs Playwright against the mock GitHub server |
| `pnpm screenshots` | Same as `pnpm e2e` but writes `docs/screenshots/*.png` at 2x, 800 px wide (only way they change) |
| `pnpm build` / `pnpm size` / `pnpm zip` | Production build, perf budget (`perf-budget.json`), release zip |
| `pnpm icons` | Re-rasterize `src/assets/logo.png` into `public/icons/*.png` |
| `pnpm lint:fix` | Biome format + safe fixes |

Needs Node 24 (`.nvmrc`) and pnpm 12 (`packageManager`; pnpm fetches that exact version). E2E runs
in Playwright's Chromium; set `PROWL_CHROMIUM=/path/to/chromium` to use another (the cloud sandbox:
`/opt/pw-browsers/chromium`; `pnpm icons` and `pnpm store-images` honour it too).

Load the built extension: `chrome://extensions` → Developer mode → Load unpacked → `dist/`.

## Conventions

- TypeScript strict, no `any` (use `unknown` + narrowing). Named exports. ES modules.
- Tests are colocated: `foo.ts` → `foo.test.ts`. Use the `chrome` fake from `src/test/chrome.ts`
  (installed globally before each test); extend the fake rather than mocking per test.
- GitHub-shaped test data comes from builders in `tests/fixtures/` (shared by unit tests and
  the E2E mock). Never hit the real GitHub API in tests.
- UI: Preact function components, `@preact/signals` for shared state, one `.css` file per
  component using tokens from `src/styles/tokens.css` only (no hex colors outside tokens).
- Design-system components live in `src/sidepanel/components/ui/`; reuse them.
- No `innerHTML` / `dangerouslySetInnerHTML`. Render untrusted GitHub text as text.
- Only open URLs that start with the configured GitHub web URL (`env.webUrl`).
- Never log or persist the token outside `auth` in `chrome.storage.local`; redact it from errors.
- New runtime dependencies need a line in `docs/decisions.md` and must fit the perf budget.
- Service worker code must not use `import()` (unsupported in MV3 workers) or DOM APIs.
- Listeners in the service worker are registered synchronously at startup (`src/background/register.ts`).
- Accessibility: every interactive element is reachable by keyboard and labelled; dialogs trap
  focus and restore it; color is never the only signal. axe must report zero violations.
- Size limits (CI): a file has at most 400 lines (tests, specs and `tests/fixtures`: 800), a function
  at most 80 lines (tests exempt) and cognitive complexity 15 (Biome `complexity` rules). Split by
  responsibility, not by line count: a file or function that does two things becomes two.
- The file limit is a ratchet: `BASELINE` in `scripts/check-file-size.mjs` lists the files already
  over (path → lines). They may shrink, never grow: lower the entry when one shrinks, delete it when
  it fits, never add one. `biome-ignore ... legacy` marks the old functions over a limit: no new ones.

## Write the least code that works

Adapted from [ponytail](https://github.com/DietrichGebert/ponytail) (MIT). Read the task and
the code it touches first, then stop at the first rung that holds:

1. Does it need to exist? Speculative need: skip it and say so in one line.
2. Already in this codebase (helper, type, pattern)? Reuse it.
3. Does the platform cover it (Web APIs, CSS, native `<dialog>`, `chrome.*`)? Use it.
4. Does an installed dependency solve it? Use it; never add one for a few lines.
5. Only then write the minimum code that works.

No single-implementation interfaces, no factories, no config for constants, no scaffolding
"for later", fewest files, shortest diff in the right place. Bug fixes fix the root cause in
the shared function. Mark deliberate shortcuts with a `ponytail:` comment naming the ceiling.
Never simplify away validation at trust boundaries, security, accessibility, error handling,
or anything the story asks for. This project's coverage gates are an explicit requirement:
test behaviour, not every function. Keep reports short: what changed, what was skipped.

## Commits

Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`, `refactor:`, `perf:`),
scope optional, e.g. `feat(github): fetch pull requests with check rollup`. Pull request titles
follow it too: `main` takes squash merges titled after the PR, and release-please reads that
title. End every commit message with these trailers, naming the model you actually run as
(`Claude Opus 5.5`, `Claude Sonnet 5.5`...):

```
Co-Authored-By: Claude <Model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JeYEyGSNpL2hJRVh3LUrtD
Signed-off-by: Arthur Emard <arthur@emard.fr>
```

The sign-off is the maintainer's DCO (`CONTRIBUTING.md`), who submits and answers for the
agents' work; CI fails a pull request with a commit that lacks one.

Never rewrite history, never force-push, never skip hooks or weaken a quality gate.

## Working knowledge

`docs/patterns.md` lists where things live, which helper to call, the test builders and the
gotchas: read the entries for the area you change, and add what you learn. Specialist roles are
in `.claude/agents/`. Ids such as `US-037` in docs and comments name the stories of the original
build; `git log --grep US-037` finds their commits.

# Prowl — guide for agents

Prowl is a client-only MV3 Chrome extension: a side panel that tracks your GitHub pull
requests, notifies on changes and lets you act on them. No backend, no telemetry.

Read `docs/architecture.md` (module map, data flow, contracts) and `docs/decisions.md`
before changing anything structural. `src/lib/model.ts` is the shared contract.

## Commands

| Command | What |
|---|---|
| `pnpm verify` | Everything CI runs: Biome, types, unit + coverage gates, build, size budget, all E2E. CI runs it on every push; it must be green before merging. |
| `pnpm verify:changed` | Before every commit: `verify:fast`, build, size budget, and only the E2E specs changed since the last commit (`--only-changed`). Run the full `pnpm verify` locally only to chase a CI failure. |
| `pnpm verify:fast` | Lint + types + unit tests (inner loop) |
| `pnpm test` / `pnpm coverage` | Vitest (coverage gates: 80% global, 95% `src/lib/diff` and `src/lib/github`) |
| `pnpm e2e` | Builds `dist-e2e/` then runs Playwright against the mock GitHub server |
| `pnpm screenshots` | Same as `pnpm e2e` but writes `docs/screenshots/*.png` at 2x, 800 px wide (only way they change) |
| `pnpm build` / `pnpm size` / `pnpm zip` | Production build, perf budget (`perf-budget.json`), release zip |
| `pnpm icons` | Re-rasterize `src/assets/logo.svg` into `public/icons/*.png` |
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
scope optional, story id in the subject when working a PRD story, e.g.
`feat(github): US-005 fetch pull requests with check rollup`. End every commit message with
these trailers, naming the model you actually run as (`Claude Opus 5.5`, `Claude Sonnet 5.5`...):

```
Co-Authored-By: Claude <Model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JeYEyGSNpL2hJRVh3LUrtD
```

Never rewrite history, never force-push, never skip hooks or weaken a quality gate.

## Ralph loop

Work is tracked in `prd.json` (stories, `passes`; `node scripts/ralph/story.mjs` prints the next
one and records results) and `progress.txt` ("Codebase patterns" at the top, the latest entries
below, older ones in `progress-archive.txt`). One story per iteration; see
`scripts/ralph/prompt.md`. Specialist roles are in `.claude/agents/`.

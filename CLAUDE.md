# Prowl — guide for agents

Prowl is a client-only MV3 Chrome extension: a side panel that tracks your GitHub pull
requests, notifies on changes and lets you act on them. No backend, no telemetry.

Read `docs/architecture.md` (module map, data flow, contracts) and `docs/decisions.md`
before changing anything structural. `src/lib/model.ts` is the shared contract.

## Commands

| Command | What |
|---|---|
| `pnpm verify` | Everything CI runs: Biome, types, unit + coverage gates, build, size budget, E2E. Must be green before every commit. |
| `pnpm verify:fast` | Lint + types + unit tests (inner loop) |
| `pnpm test` / `pnpm coverage` | Vitest (coverage gates: 80% global, 95% `src/lib/diff` and `src/lib/github`) |
| `pnpm e2e` | Builds `dist-e2e/` then runs Playwright against the mock GitHub server |
| `pnpm build` / `pnpm size` / `pnpm zip` | Production build, perf budget (`perf-budget.json`), release zip |
| `pnpm icons` | Re-rasterize `src/assets/logo.svg` into `public/icons/*.png` |
| `pnpm lint:fix` | Biome format + safe fixes |

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

## Commits

Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`, `refactor:`, `perf:`),
scope optional, story id in the subject when working a PRD story, e.g.
`feat(github): US-005 fetch pull requests with check rollup`. End every commit message with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JeYEyGSNpL2hJRVh3LUrtD
```

Never rewrite history, never force-push, never skip hooks or weaken a quality gate.

## Ralph loop

Work is tracked in `prd.json` (stories, `passes`) and `progress.txt` (append-only log with a
"Codebase patterns" section at the top). One story per iteration; see `scripts/ralph/prompt.md`.
Specialist roles are in `.claude/agents/`.

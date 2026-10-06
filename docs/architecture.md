# Architecture

Prowl is a Manifest V3 Chrome extension with no backend. The only remote host is GitHub
(`api.github.com`, plus `github.com` for the OAuth device flow).

```
            ┌──────────────────────── chrome.storage.local ────────────────────────┐
            │ settings · auth · snapshot · pollState · prLocal                     │
            └───────▲───────────────────────────────▲──────────────────────────────┘
                    │ write                          │ read + onChanged
┌───────────────────┴───────────┐        ┌───────────┴───────────────────────────┐
│ Service worker (background)   │◀──msg──│ Side panel (Preact)                    │
│ alarms → poll → diff →        │        │ store (signals) ← storage              │
│ notifications + badge         │        │ views: onboarding · list · settings    │
└───────────────┬───────────────┘        │ user actions → GitHub, then poll msg   │
                │ GraphQL / REST          └───────────────┬───────────────────────┘
                ▼                                         ▼
                         api.github.com  (src/lib/github)
```

## Responsibilities

| Context | Owns | Never does |
|---|---|---|
| Service worker `src/background/` | Polling schedule (`chrome.alarms`), fetching PRs, diffing snapshots, notifications, badge, persisting `snapshot` and `pollState` | Render UI |
| Side panel `src/sidepanel/` | Rendering from storage, onboarding/auth, settings, user actions (approve, merge, ...) | Poll on a timer |
| `src/lib/*` | Pure, unit-tested logic shared by both | Touch `chrome.*` except `src/lib/storage` |

After a user action succeeds, the panel sends `{ type: 'poll', force: true }` so the service
worker refreshes the snapshot. The panel never writes `snapshot` itself, except optimistic
in-memory updates that the next snapshot replaces.

## Module map

| Path | Purpose | Coverage gate |
|---|---|---|
| `src/lib/model.ts` | Domain types (the contract). Change with care. | n/a |
| `src/lib/env.ts` | Build-time config (API URL, web URL, OAuth client id) | 80% |
| `src/lib/storage/` | Typed `chrome.storage.local` access, settings defaults + validation + migrations, local PR state (snooze/mute/seen) | 80% |
| `src/lib/github/` | HTTP client (GraphQL + REST), errors, rate limits, queries, mappers, search query builder, actions, auth (PAT validation, device flow) | **95%** |
| `src/lib/diff/` | `diffSnapshots(prev, next, viewer)` → `PrEvent[]`. Pure. | **95%** |
| `src/lib/time/` | Relative time, quiet hours, backoff | 80% |
| `src/background/` | Service worker wiring: poller, notifier, badge, message router | 80% |
| `src/sidepanel/` | UI: `App.tsx`, `state/`, `views/`, `components/`, `components/ui/` (design system) | 80% |
| `src/styles/` | `tokens.css` (design tokens, light/dark), `base.css` | n/a |
| `src/test/` | `chrome.ts` fake used by every unit test | excluded |
| `tests/fixtures/` | Builders for GitHub-shaped GraphQL nodes, shared by unit tests and the E2E mock | n/a |
| `tests/e2e/` | Playwright specs, fixtures, `mock-github/` server | n/a |

## Data flow of a poll

1. `chrome.alarms` fires `poll` every `settings.pollIntervalMinutes` (min 1, default 2).
2. The poller skips if no auth, if a poll is in flight (single-flight), or if
   `pollState.nextAllowedAt` is in the future (backoff or rate limit), unless forced and not
   rate-limited.
3. For each enabled section, build a search query (`src/lib/github/search.ts`) and fetch with
   one GraphQL search query per section (paginated up to `maxPerSection`), selecting
   `rateLimit { limit remaining resetAt cost }`.
4. PRs present in the previous snapshot but missing now are fetched by id (`nodes(ids:)`) to
   learn whether they were merged or closed, and by whom.
5. Apply repo include/exclude filters, build the new `Snapshot`, persist it.
6. `diffSnapshots(prev, next, viewer.login)` produces events. The first snapshot after sign-in
   produces none (no notification storm).
7. Notifier filters events (per-event toggles, mute, snooze, quiet hours) and creates
   `chrome.notifications`. Clicking opens the PR.
8. Badge recomputes from the snapshot + local state.
9. On error: classify (`ErrorKind`), store in `pollState.lastError`, exponential backoff with
   jitter (`interval × 2^failures`, capped at 30 min). On `rate_limited` or low remaining
   budget (< 100 points) wait until `resetAt`. `unauthorized` stops polling until re-auth.

## GitHub API usage

- GraphQL for reads (search, PR state, repo merge settings) and most writes
  (`addPullRequestReview`, `addComment`, `mergePullRequest`, `markPullRequestReadyForReview`,
  `convertPullRequestToDraft`).
- REST for re-running checks (`POST /repos/{o}/{r}/actions/runs/{id}/rerun-failed-jobs`,
  `POST /repos/{o}/{r}/check-suites/{id}/rerequest`) and reading token scopes
  (`GET /user`, header `x-oauth-scopes`).
- Every request: `Authorization: Bearer <token>`, `X-GitHub-Api-Version: 2022-11-28` for REST,
  20 s timeout. Errors never include the token.
- Check counts come from `statusCheckRollup.contexts.checkRunCountsByState` /
  `statusContextCountsByState` so the list query stays cheap; individual check runs are
  fetched only when a PR is expanded.

## Auth

- **PAT** (classic or fine-grained): pasted in onboarding, validated with `viewer { login }`
  and `GET /user` (scopes header). Required: classic `repo` (or `public_repo` for public-only);
  fine-grained: Pull requests R/W, Contents R/W (merge), Checks R, Actions R/W (re-run),
  Commit statuses R, Metadata R.
- **OAuth device flow**: needs an OAuth App client id (`PROWL_GITHUB_CLIENT_ID` at build time).
  `github.com` is an optional host permission requested right before the flow starts. Scope
  `repo`. Without a client id the UI explains how to use a PAT instead.
- The token lives only in `chrome.storage.local` under `auth`. Sign-out deletes `auth`,
  `snapshot`, `pollState` and clears the badge and alarms.

## Side panel

- Preact 10 + `@preact/signals`. `src/sidepanel/state/store.ts` mirrors storage keys into
  signals and subscribes to `chrome.storage.onChanged`.
- Hash routes: `#/` list, `#/settings`, `#/onboarding`. Expanded PR state is local UI state.
- Components in `src/sidepanel/components/ui/` are the design system; feature components
  compose them. One CSS file per component, tokens only (no raw colors).

## Testing

- Unit: Vitest + happy-dom + `src/test/chrome.ts`. Colocated `*.test.ts(x)`.
- E2E: Playwright loads `dist-e2e/` (`vite build --mode e2e`) whose API and web URLs point to
  the mock server on `http://127.0.0.1:4010`. Seed auth/settings via
  `serviceWorker.evaluate(...)`; drive polls with `{ type: 'poll', force: true }`; assert on
  `github.requests` and on `chrome.notifications.getAll()` in the worker.
- Every screen gets an axe check; screenshot specs write to `docs/screenshots/`.

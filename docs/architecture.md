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
| `src/lib/storage/` | Typed `chrome.storage.local` access, settings defaults + validation + migrations, local PR state (snooze/mute/seen); see [Storage](#storage) | 80% |
| `src/lib/github/` | HTTP client (GraphQL + REST), errors, rate limits, queries, mappers, search query builder, actions, auth (PAT validation, device flow) | **95%** |
| `src/lib/diff/` | `diffSnapshots(prev, next, viewer)` → `PrEvent[]`. Pure. | **95%** |
| `src/lib/time/` | Relative time (`formatRelativeTime`), quiet hours, backoff (`backoff.ts`) | 80% |
| `src/background/` | Service worker wiring: `register.ts` (listeners), `poller.ts`, `messages.ts` (router), notifier, badge; see [Service worker](#service-worker) | 80% |
| `src/sidepanel/` | UI: `App.tsx`, `state/`, `views/`, `components/`, `components/ui/` (design system) | 80% |
| `src/styles/` | `tokens.css` (design tokens, light/dark), `base.css` | n/a |
| `src/test/` | `chrome.ts` fake used by every unit test | excluded |
| `tests/fixtures/` | Builders for GitHub-shaped GraphQL nodes, shared by unit tests and the E2E mock | n/a |
| `tests/e2e/` | Playwright specs, fixtures, `mock-github/` server | n/a |

## Data flow of a poll

1. `chrome.alarms` fires `poll` every `settings.pollIntervalMinutes` (min 1, default 2). The
   worker also polls on `runtime.onInstalled` / `onStartup`, and a forced poll on the panel's
   `{ type: 'poll', force: true }`.
2. The poller skips if no auth (and clears the alarm), if the token was rejected (unless
   forced), or if `pollState.nextAllowedAt` is in the future: a forced poll skips a backoff
   but never a rate-limit wait. Concurrent triggers share the poll in flight (single-flight).
3. `fetchPullRequests` (see [Fetching pull requests](#fetching-pull-requests)) builds each
   enabled section's search query (`src/lib/github/search.ts`) and fetches it with
   `query ProwlSearch` (pages of 50, cursor-paginated up to `maxPerSection`), selecting
   `rateLimit { limit remaining resetAt cost }`.
4. Open PRs present in the previous snapshot but missing now are fetched by id
   (`query ProwlNodes`, `nodes(ids:)`) to learn whether they were merged or closed, and by whom.
5. Repo include/exclude filters are applied; the poller adds `fetchedAt`, the viewer (from
   `auth`), `sectionErrors` and `settledChecks` to build the new `Snapshot`, and persists it
   with `pollState` in one write. Local PR state of PRs no longer in the snapshot is pruned.
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
  20 s timeout, `cache: 'no-store'`. Errors never include the token.
- Check counts come from `statusCheckRollup.contexts.checkRunCountsByState` /
  `statusContextCountsByState` so the list query stays cheap; individual check runs are
  fetched only when a PR is expanded.

## GitHub client

`src/lib/github/client.ts`: `createGitHubClient({ token, apiUrl, fetch? })` returns
`graphql<T>(query, variables?, { partial? })` and `rest<T>(method, path, body?)`. It runs in the
service worker and the side panel (global `fetch`, `AbortController`, nothing else), does not
retry (the poller owns backoff) and throws only `GitHubError` (`errors.ts`): `kind`
(`ErrorKind`), `status` (null without a response), `resetAt` (ISO, exhausted primary limit) and
`retryAfterSeconds`. Messages come from GitHub's `message`, truncated to 300 characters with the
token masked; network errors carry no `cause`, so nothing fetch threw can leak the token.

| Response | Kind |
|---|---|
| 401 | `unauthorized` |
| 429; 403 with `x-ratelimit-remaining: 0`, a `retry-after` header or a "rate limit" / "abuse detection" message | `rate_limited` |
| other 403, 451 | `forbidden` |
| 404, 410 | `not_found` |
| other 4xx (400, 409, 422) | `validation` |
| 5xx, unusable 2xx body, non-2xx below 400 | `server` |
| fetch rejects, body fails to download, 20 s timeout | `network` |

For a rate limit, `resetAt` is set only when the primary budget is exhausted and
`retryAfterSeconds` is GitHub's `retry-after`, or 60 when GitHub gave neither (its guidance for
secondary limits). The poller waits until the later of the two.

GraphQL answers 200 even when a field failed. `graphql` throws on the first entry of `errors`
(`RATE_LIMITED` -> `rate_limited`, `FORBIDDEN` / `INSUFFICIENT_SCOPES` -> `forbidden`,
`NOT_FOUND` -> `not_found`, `UNPROCESSABLE` -> `validation`, anything else -> `graphql`), with the
reset taken from the response headers. Reads that tolerate holes (`nodes(ids:)` with a deleted
PR, a search over an org that needs SAML) pass `{ partial: true }` to get the data that did come
back; mutations stay strict because their payload is null when they fail.
`parseRateLimit(headers | rateLimit object)` (`rateLimit.ts`) normalizes both sources to the
model's `RateLimit`.

## Search queries

`src/lib/github/search.ts` turns a `Section` into the GitHub search string of one list. Every
query starts with `is:pr`, which cannot be OR-ed away: AND / OR / NOT only combine search words,
never qualifiers.

| Section | Query |
|---|---|
| `authored` | `is:pr is:open author:@me archived:false` |
| `review_requested` | `is:pr is:open review-requested:@me archived:false` (includes your teams) |
| `mentioned` | `is:pr is:open mentions:@me archived:false` |
| `assigned` | `is:pr is:open assignee:@me archived:false` |
| `custom` | `is:pr <the user's query>` (open or closed as the query says) |

`fetchPullRequests` appends `sort:updated-desc` unless a custom query has its own `sort:`.

- `buildSearchQuery(section, settings)` appends the repo filters: `repoInclude` becomes
  `repo:owner/name` or `user:owner` (`user:` also matches organizations), `repoExclude` becomes
  `-repo:owner/name` or `-user:owner`. Positive scopes are OR-ed by GitHub; a custom query that
  brings its own `repo:` / `org:` / `user:` keeps it and the include list is applied client-side
  only, so the result is the intersection.
- `filterByRepo(prs, settings)` enforces both lists client-side (case-insensitive; a pattern is a
  PR's owner or its `owner/name`; exclude wins). It is the source of truth because GitHub
  treats a scope that the exclusions cancel out completely as no scope at all.
- `validateCustomQuery(query)` returns readable errors (empty array = valid) for an empty
  query, `is:issue` / `type:issue` / `-is:pr`, operators between qualifiers only, and GitHub's
  search limits: at most 5 AND / OR / NOT operators and 256 characters of search words,
  qualifiers not counted (verified against the search API, which answers 422 otherwise).
  Callers (settings screen, poller) skip a custom section that fails validation.

## Fetching pull requests

`fetchPullRequests(client, settings, previous)` (`src/lib/github/fetchPullRequests.ts`) is all of
a poll's reads, sent one at a time (GitHub's advice against secondary rate limits). It returns
`{ pullRequests, sections, sectionErrors, rateLimit }`:

- Each enabled section runs `query ProwlSearch` (`queries.ts`) with its search string plus
  `sort:updated-desc` (unless a custom query has its own `sort:`), so the `maxPerSection` PRs
  kept are the most recently updated. A custom section that fails `validateCustomQuery` is not
  sent, and one GitHub refuses (`validation`, `not_found`, `forbidden`, `graphql`) is reported
  in `sectionErrors` (section id -> message) while the other sections load. Any other failure,
  and any failure of a preset section, throws the `GitHubError` for the poller.
- Nodes are mapped (`mapPullRequest.ts`), filtered with `filterByRepo` and deduped:
  `pullRequests` by id, `sections` as ordered ids (a PR may be in several).
- Open PRs of `previous` that are in no section now (and pass the repo filters) go through
  `query ProwlNodes($ids)`, 100 ids per query. Merged or closed ones stay in `pullRequests`,
  in no section, with `state`, `updatedAt` and `closedBy` (`mergedBy`, else the actor of the
  latest `ClosedEvent`), so the diff can emit `merged` / `closed`. Still-open ones only
  stopped matching and are dropped; merged or closed ones are never looked up again.
- Both queries pass `{ partial: true }`: an org that requires SAML or a deleted PR leaves a
  null node, which is skipped. `search` is non-null in the schema, so a search that fails as a
  whole nulls `data` and still throws.

Mapping (`mapPullRequest`):

| Field | Rule |
|---|---|
| `checks` | Head commit `checkRunCountsByState` + `statusContextCountsByState`. failed: FAILURE, ERROR, TIMED_OUT, STARTUP_FAILURE, ACTION_REQUIRED; pending: PENDING, EXPECTED, QUEUED, IN_PROGRESS, WAITING; passed: SUCCESS; neutral: anything else (NEUTRAL, SKIPPED, CANCELLED, STALE, new values). State: `failure` if any failed, else `pending` if any pending, else `success` if any, else `none`. `statusCheckRollup.state` is not used. |
| enums | Lower-cased when the model knows the value; otherwise `none` (`reviewDecision`, also when null), `unknown` (`mergeable`, `mergeStateStatus`), `open` (`state`). |
| `reviews` | `latestReviews`, newest first; PENDING and unknown states dropped. |
| `requestedReviewers` | Users, bots and mannequins. Teams are not selected: every `Team` field needs `read:org` and would fail the whole query for a `repo`-only token. |
| `labels` | Color lower-cased when it is six hex digits, else `NEUTRAL_LABEL_COLOR` (`ededed`). |
| `unresolvedThreads` | Unresolved among the first 100 review threads. |
| `lastComment` | Latest issue comment. Deleted accounts: `author: null`; review and comment authors become `ghost`. |
| `closedBy` | `mergedBy` in search results; `ProwlNodes` adds the `ClosedEvent` actor. |
| `allowedMergeMethods` | Repository `mergeCommitAllowed`, `squashMergeAllowed`, `rebaseMergeAllowed`. |

Estimated cost (GitHub counts the requests every connection could need, divides by 100 and
rounds; `rateLimit.cost` in each response gives the real figure):

| Query | Requests | Points |
|---|---|---|
| `ProwlSearch`, page of 50 | 1 + 50 x 7 nested connections (labels, latestReviews, reviewRequests, reviewThreads, comments, commits, contexts) = 351 | about 4 |
| `ProwlNodes`, 100 ids | 1 + 100 (timelineItems) = 101 | 1 |

The default settings (one section, 50 PRs, every 2 minutes) cost about 120 points an hour of
the 5,000; four sections of 100 PRs every minute stay under 2,000.

## Diff engine

`diffSnapshots(prev, next, viewerLogin)` (`src/lib/diff/diffSnapshots.ts`) compares the PRs
present in both snapshots and returns `PrEvent[]`, oldest first. A null `prev` (first poll after
sign-in) or a `prev` taken for another account gives `[]`. A PR in only one snapshot gives
nothing: a new one has no baseline, a missing one simply left the search scope (merged and
closed PRs stay in `next`, see above). Changes the viewer made are left out; logins compare
case-insensitively.

| Event | prev -> next | `actor` | `at` | Id key |
|---|---|---|---|---|
| `ci_failed` | checks become `failure`, or are `failure` on a new head commit | null | `next.fetchedAt` | head SHA |
| `ci_passed` | checks `success` after CI last concluded `failure` (pending polls in between, see below) | null | `next.fetchedAt` | head SHA |
| `approved`, `changes_requested`, `review_new` | a review id not in prev, state approved / changes requested / commented (dismissed: nothing), not by the viewer | reviewer | `submittedAt` | review id |
| `comment_new` | `commentCount` grows and the latest issue comment is newer than before and not by the viewer | commenter | its `createdAt` | its `createdAt` |
| `ready_to_merge` | `isReadyToMerge` turns true: open, not a draft, and `mergeStateStatus` `clean`, or `reviewDecision` approved / none with checks success / none and `mergeable` | null | `next.fetchedAt` | head SHA |
| `merged`, `closed` | `open` -> merged / closed and `closedBy` is not the viewer (null, unknown, counts as someone else) | `closedBy` | `updatedAt` | head SHA |

Ids are `<pr id>:<type>:<key>` and never include the poll time, so a poll repeated after a
worker restart yields the same ids for the notifier to dedupe; the price is one event of each
kind per head commit (a re-run that fails again on the same commit reuses the id).
`comment_new` needs a newer latest issue comment because `commentCount` also counts review
comments, which the review events already report. `isReadyToMerge` is exported for the badge.

CI usually goes failure -> pending (a fix pushed, a re-run) -> success, so `ci_passed` compares
with the state CI last concluded rather than the previous poll: `snapshot.settledChecks` holds,
for each PR whose checks are pending, the last non-pending state, and the poller builds it with
`carrySettledChecks(prev, next.pullRequests)` (exported next to `diffSnapshots`).
failure -> pending -> success gives one `ci_passed`, success -> pending -> success none.
`ci_failed` still compares consecutive polls (a failure after pending is news either way).

## Service worker

`register.ts` adds every listener synchronously at startup: install / startup (side panel
behavior, then `poll()`), the `poll` alarm, `runtime.onMessage` (`messages.ts`) and settings
changes (a new `pollIntervalMinutes` replaces a running alarm; nothing is scheduled while
signed out or stopped).

`poller.ts`:

- `poll({ force })` runs at most one poll at a time (an in-memory promise; concurrent callers
  share it) and never rejects. It resolves to `{ snapshot, events }` when a poll ran and
  stored a snapshot, null otherwise. Notifications (US-008) and the badge (US-009) hook in at
  the end of the poll itself, once per poll, not in its callers.
- Every poll that is not skipped for sign-out or a rejected token ensures the alarm exists
  with the current period (`scheduleAlarm`): Chrome may drop alarms on browser restart.
- `pollState` is written twice: `inFlight: true` with `lastAttemptAt` before fetching, then
  the outcome. Single-flight lives in memory, so a stored `inFlight: true` seen by a poll that
  is skipped is stale (the worker stopped mid-poll) and is reset.
- Outcome (pure helpers in `src/lib/time/backoff.ts`):

  | Outcome | `nextAllowedAt` | Other |
  |---|---|---|
  | success | `rateLimit.resetAt` when fewer than 100 points remain, else null | failures 0, `lastError` null, `lastSuccessAt` |
  | `rate_limited` | later of `resetAt` and now + `retryAfterSeconds` | failures + 1 |
  | `unauthorized` | null | alarm cleared: only a forced poll (re-auth, refresh) tries again |
  | any other error | now + `interval × 2^failures` (this failure included), at most 30 min, minus up to 25% jitter | failures + 1 |

  A wait after an error other than `rate_limited` is a backoff, which a forced poll skips; a
  wait after a rate limit or a low-budget success is not. Waits are capped at one hour, and a
  stored wait longer than that is ignored (the clock went back). A failure of something other
  than GitHub (a bug) is stored as `server` with a generic message; details go to the console.
- A custom section that GitHub refuses lands in `snapshot.sectionErrors` and the poll counts as
  a success. While any section failed, pruning keeps the local state of PRs not in the
  snapshot (only ended snoozes go), since that section's PRs are missing.
- Before storing anything the poller re-reads `auth`: if its token changed (sign-out, another
  account) the result is dropped; it starts over when someone is signed in, else it clears
  what a sign-out clears. A snapshot of another account is never used as the baseline.

`messages.ts` accepts `BackgroundRequest`s from this extension only (`sender.id`), validates
their shape, and answers (with nothing) once handled, so `await sendMessage(...)` resolves when
a forced poll is done. `markSeen` stores the snapshot's `updatedAt` of each known PR;
`signedOut` calls `clearSignedOut()`: the `poll` alarm, `pollState`, the badge text and every
notification.

## Storage

All persistent state lives in `chrome.storage.local` under the `STORAGE_KEYS` of
`src/lib/model.ts`; nothing uses `storage.sync`. `src/lib/storage/` is the only code that calls
`chrome.storage.local`:

- `storage.ts`: typed `getItem` / `getItems` / `setItem` / `setItems` / `removeItems` /
  `subscribe(key, listener)` over `StorageSchema` (key -> model type), plus
  `updateItem(key, update)`, a read-modify-write that holds a Web Lock named
  `prowl:storage:<key>` (shared by the side panel and the service worker, which have the same
  origin) and skips the write when the value is unchanged. Chrome itself fires `onChanged`
  only for values that actually changed.
- `settings.ts`: `DEFAULT_SETTINGS` (frozen), `normalizeSettings(unknown)` which repairs any
  stored value (migrations first, then defaults for missing or invalid fields, clamping, unknown
  keys dropped), `loadSettings`, `updateSettings(patch | updater)`, `ensureSettings` (persist
  migrated settings, for `runtime.onInstalled`) and `subscribeSettings`.
  - Presets (`authored`, `review_requested`, `mentioned`, `assigned`) always exist exactly once
    with `id === kind` and a fixed label; they are enabled or disabled, never deleted. Custom
    sections need a non-empty `query`; a missing, invalid or duplicate id becomes `custom-N`.
  - `pollIntervalMinutes` is an integer in 1-60, `maxPerSection` in 1-100, quiet hours are
    `HH:MM`, repo filters are `owner` or `owner/name` (deduplicated, case-insensitive).
  - Migrations: `SETTINGS_MIGRATIONS[n]` upgrades raw settings from version `n` to `n + 1`.
    Unversioned data counts as version 1; data from a newer version is normalized best-effort.
- `prLocal.ts`: pure reducers over `PrLocalState` (`snooze`, `unsnooze`, `mute`, `unmute`,
  `markSeen`, `pruneExpired`), which return the same object when nothing changes, and
  predicates (`isSnoozed`, `isMuted`, `isSeen`); `updatePrLocal(fn)` applies reducers in one
  locked write. `markSeen` never moves backwards. `pruneExpired(state, now, knownIds)` drops ended snoozes and
  every entry for PRs not in `knownIds` (the snapshot's PR ids).

Readers of `auth`, `snapshot` and `pollState` trust the stored shape: only Prowl writes them.

## Auth

- **PAT** (classic or fine-grained): pasted in onboarding, validated with `viewer { login }`
  and `GET /user` (scopes header). Required: classic `repo` (or `public_repo` for public-only);
  fine-grained: Pull requests R/W, Contents R/W (merge), Checks R, Actions R/W (re-run),
  Commit statuses R, Metadata R.
- **OAuth device flow**: needs an OAuth App client id (`PROWL_GITHUB_CLIENT_ID` at build time).
  `github.com` is an optional host permission requested right before the flow starts. Scope
  `repo`. Without a client id the UI explains how to use a PAT instead.
- The token lives only in `chrome.storage.local` under `auth`. Sign-out: the panel deletes
  `auth`, `snapshot` and `pollState`, then sends `{ type: 'signedOut' }`; the worker clears the
  alarm, `pollState`, the badge and notifications, and drops a poll that was in flight.

## Side panel

- Preact 10 + `@preact/signals`. `src/sidepanel/state/store.ts` has one signal per storage key
  (`settings`, `auth`, `snapshot`, `pollState`, `prLocal`) plus `hydrated`. `main.tsx` calls
  `hydrateStore()` before the first render: it subscribes to every key, reads them in one call
  (a change that lands during that read wins over it), normalizes `settings` and `prLocal`, and
  flips `hydrated`. `App` shows a skeleton (`main[aria-busy]`) until then. Signals are never
  written by the panel; the service worker's storage writes arrive through `onChanged`.
- Hash routes (`state/router.ts`): `#/` list, `#/settings`, `#/onboarding`. `route` is derived
  from the hash and `auth`: signed out is always `onboarding`; signed in shows `onboarding` only
  when the hash asks for it (re-authentication), unknown hashes mean the list. `navigate(route)`
  updates the hash and the signal synchronously. After a route change `<main>` takes focus
  (labelled with the view's name), but not on first load. Expanded PR state is local UI state.
- `Header`: brand, "Updated 2 min ago" (`snapshot.fetchedAt`, ticks every 15 s), refresh
  (`sendToBackground({ type: 'poll', force: true })`, spinner while `pollState.inFlight`),
  settings / back toggle and the account menu (avatar; sign-out joins it in US-011). Signed out
  or before hydration it is the brand alone.
- `state/background.ts`: `sendToBackground(BackgroundRequest)` resolves even when the worker has
  no receiver. `openUrl.ts`: `openGitHubUrl(url)` is the only way the panel opens a URL, and it
  refuses anything outside the `env.webUrl` origin.
- Theme: `settings.theme` becomes `data-theme` on `<html>` (`system` removes it, so
  `prefers-color-scheme` applies); `<ToastRegion />` is mounted once in `App`.
- Components in `src/sidepanel/components/ui/` are the design system; feature components
  compose them. One CSS file per component, tokens only (no raw colors).

## Testing

- Unit: Vitest + happy-dom + `src/test/chrome.ts`. Colocated `*.test.ts(x)`.
- E2E: Playwright loads `dist-e2e/` (`vite build --mode e2e`) whose API and web URLs point to
  the mock server on `http://127.0.0.1:4010`. Seed auth/settings with the `seedStorage(items)`
  fixture (it writes `chrome.storage.local` from the service worker, so an open panel updates
  live) or `signIn(overrides?)`; drive polls with `poll()` (a forced poll sent from an extension
  page, resolved once it is done); assert on `github.requests` and on
  `chrome.notifications.getAll()` in the worker.
- Every screen gets an axe check; screenshot specs write to `docs/screenshots/`.

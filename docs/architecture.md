# Architecture

Prowl is a Manifest V3 Chrome extension with no backend. The only remote host is GitHub
(`api.github.com`, plus `github.com` for the OAuth device flow). This page is the reference for
the module map, the data flow, the contracts between modules and the invariants behind them.
History and rationale are in [decisions.md](decisions.md); where to find a helper and the
gotchas are in [patterns.md](patterns.md). When a detail here and the code disagree, the code
wins and this page is fixed.

```
            ┌──────────────────────── chrome.storage.local ─────────────────────────┐
            │ settings · auth · snapshot · pollState · prLocal · teams · panelState │
            └───────▲───────────────────────────────▲───────────────────────────────┘
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
| Service worker `src/background/` | Polling schedule (`chrome.alarms`), fetching PRs, diffing snapshots, notifications, badge, writing `snapshot`, `pollState` and `teams` | Render UI |
| Side panel `src/sidepanel/` | Rendering from storage, sign-in, settings, user actions (approve, merge, ...), expanded-card reads | Poll on a timer, write `snapshot` |
| `src/lib/*` | Unit-tested logic shared by both | Touch `chrome.*`, except `src/lib/storage` and `src/lib/i18n.ts` |

After a user action succeeds, the panel sends `{ type: 'poll', reason: 'change' }` and the worker
refreshes the snapshot. The panel's only snapshot changes are optimistic in-memory ones that the
next snapshot replaces.

## Module map

| Path | Purpose | Coverage gate |
|---|---|---|
| `src/lib/model.ts` | Domain types: the contract (re-exports `modelSettings.ts`). Change with care. | n/a |
| `src/lib/env.ts` | Build-time config (API URL, web URL, OAuth client id) | 80% |
| `src/lib/storage/` | Typed `chrome.storage.local`, settings defaults, validation and migrations, local PR state, the session lock | 80% |
| `src/lib/github/` | HTTP client, errors, rate limits, queries and mappers, search builder, team discovery, actions, auth (PAT, device flow) | **95%** |
| `src/lib/diff/` | `diffSnapshots(prev, next, viewer)` → `PrEvent[]`; CI transitions (`checkTransitions.ts`). Pure. | **95%** |
| `src/lib/notify/` | `filterEvents`, notification texts (`messages.ts`), the quiet-hours digest (`quietDigest.ts`). Pure. | 80% |
| `src/lib/badge/` | `computeBadge(snapshot, prLocal, mode, now)` → text, tooltip, danger flag. Pure. | 80% |
| `src/lib/turn/` | `whoseTurn`, `turnIn`, `yourTurnIds`, `turnSummary`. Pure. | 80% |
| `src/lib/mergeEligibility.ts` | `isReadyToMerge`, `failingChecksBlock`, `mergesItself`, `awaitsMerge`: the one merge rule, apart so `diff` and `turn` do not import each other. Pure. | 80% |
| `src/lib/activity.ts` | `activityKey(pr)`: the facts that count as activity for "unseen". Pure. | 80% |
| `src/lib/stacks.ts` | `listItems`, `stackMembers`, `stackState`, `stackSummary`. Pure. | 80% |
| `src/lib/url.ts` | `isGitHubUrl`: the one allowlist for URLs Prowl opens | 80% |
| `src/lib/time/` | Relative time, quiet hours, snooze times, backoff, the cadence policy (`cadence.ts`) | 80% |
| `src/lib/ai/` | Chrome's on-device AI, feature-detected (`builtInAi.ts`), input fitting (`fitInput.ts`). Panel only. | 80% |
| `src/lib/i18n.ts`, `src/lib/sectionLabel.ts`, `public/_locales/` | Typed messages, saved language, English fallback, localized counts and dates; built-in section names | 80% |
| `src/background/` | `register.ts` (listeners), `poller.ts`, `pollState.ts` (alarms, failures), `fastLane.ts`, `mergeState.ts` (consulted cards, priority hints), `messages.ts`, `notifier.ts`, `badge.ts`, `sync.ts` | 80% |
| `src/sidepanel/` | `App.tsx`, `state/`, `views/`, `components/`, `components/ui/` (design system) | 80% |
| `src/styles/` | `tokens.css`, `tokens.base.css`, `base.css` ([design.md](design.md)) | n/a |
| `src/test/` | The `chrome` fake and panel builders | excluded |
| `tests/fixtures/` | GitHub-shaped builders shared by unit tests and the E2E mock; the pinned GitHub schema; the manifest lock | n/a |
| `tests/e2e/` | Playwright specs, fixtures, `mock-github/` server | n/a |
| `site/` | Astro site for GitHub Pages (base `/prowl/`, no JS); renders `docs/auth.md`, `docs/privacy.md`, `CHANGELOG.md`, `CONTRIBUTING.md` | n/a |

## Data flow of a poll

1. A trigger asks `poll({ reason })` (`poller.ts`): the `poll` alarm, startup, the fast lane,
   window focus or a panel message. `pollVerdict` decides whether it runs (see
   [Poll reasons](#poll-reasons-and-cadence)). Polls are single-flight under the `prowl:poll`
   lock; `inbox` and `change` reasons and team refreshes share one trailing poll instead.
2. No `auth`: both alarms are cleared and nothing runs. Otherwise both alarms are ensured
   (`scheduleAlarms`) and `pollState` is written with `inFlight: true`.
3. Teams are discovered first when due or asked (see [Teams](#teams)).
4. `fetchPullRequests` (`src/lib/github/fetchPullRequests.ts`) searches each enabled section in
   turn (`ProwlSearch`), then reads missing open PRs by id (`ProwlNodes`) to learn whether they
   were merged or closed, then reads merge facts (`ProwlMergeState`) in batches. Requests go one
   at a time (GitHub's advice against secondary limits).
5. The poller publishes a snapshot after each completed section, before merge reads and after
   each merge batch. Each publication is diffed against the previous publication, repaints the
   badge and notifies, so events never repeat within a poll.
6. The final snapshot is stored with `pollState` (and `teams` when discovered). Ended snoozes,
   and local choices of PRs confirmed closed, are then pruned from `prLocal`.
7. On error the failure is classified and stored, and the next attempt waits (see
   [Poll outcome](#poll-outcome)).

## Contracts

### Messages (`BackgroundRequest`, `src/lib/model.ts`)

The panel sends these with `chrome.runtime.sendMessage`; `messages.ts` accepts them from this
extension only (`sender.id`), validates their shape and answers with nothing once handled, so
`await sendMessage(...)` resolves when the work is done.

| Message | Worker does |
|---|---|
| `{ type: 'poll', reason: 'panel' \| 'user' \| 'change' }` | `poll({ reason })`. A page may not claim the worker's own reasons. |
| `{ type: 'markSeen', prIds, versions }` | Marks each PR seen when its `updatedAt` and `activityKey` still match `versions` (`facts` at most 16 KB), under the session lock |
| `{ type: 'refreshMergeState', prId, headSha }` | Reads one consulted card's merge facts (40-hex `headSha`); see [Merge facts](#merge-facts) |
| `{ type: 'mergePriority', prIds }` | Per-document priority hints from cards on screen; never starts a request, expires after a minute |
| `{ type: 'refreshTeams' }` | `poll({ reason: 'user', refreshTeams: true })` |
| `{ type: 'signedOut' }` | `clearSignedOut()`: alarms, `pollState`, badge, notifications, the `notified` and `inbox` session state, seen facts |

### Poll reasons and cadence

`pollVerdict(reason, pollState, snapshot.fetchedAt, interval, now)` (`src/lib/time/cadence.ts`)
is the one cadence policy. Callers never gate a trigger on age or backoff themselves.

| Reason | Who asks | Runs on a list older than | Through backoff / rejected token |
|---|---|---|---|
| `schedule` | the `poll` alarm | always | no |
| `startup` | install, browser start | always | no |
| `inbox` | fast lane: a relevant PR thread changed | always (trailing) | no |
| `ci` | fast lane: CI running on the viewer's own listed PR (`ciWatched`) | 110 s (`CI_STALE_MS`) | no |
| `focus` | a Chrome window got focus | the poll interval | no |
| `panel` | the panel opened or became visible (`refreshIfStale`) | 1 min | no |
| `user` | Refresh, shortcut, banner retry, team refresh | always | yes |
| `change` | settings saved, action done, sign-in | always (trailing) | yes |

A rate-limit wait (after a rate limit, or a success that left fewer than 100 points) holds every
reason, explicit ones included. A list dated in the future (the clock went back) counts as stale.
The trailing poll runs for the strongest reason asked (explicit, then `inbox`) and reads the
latest settings.

### Storage keys

All persistent state is in `chrome.storage.local` under `STORAGE_KEYS`; only `src/lib/storage/`
calls it. Readers of `auth`, `snapshot`, `pollState` and `teams` trust the shape (only Prowl
writes them); everything else is normalized on read.

| Key | Type | Written by | Notes |
|---|---|---|---|
| `settings` | `Settings` | panel (`saveSettings`), sync | Version 2, migrated on read (`SETTINGS_MIGRATIONS`) |
| `auth` | `AuthState` | panel (sign-in / sign-out) | The only place the token lives |
| `snapshot` | `Snapshot` | worker | See [Snapshot](#snapshot) |
| `pollState` | `PollState` | worker | Last attempt, success, error, wait, rate limit, `inFlight`, `mergePending` |
| `prLocal` | `PrLocalState` | both, via `updatePrLocal` | Snooze, mute, seen timestamps and `seenFacts`; never sent anywhere |
| `teams` | `TeamsState` | worker (with the snapshot) | Removed at sign-in and sign-out |
| `panelState` | `PanelState` | panel | Login, selected section, folded groups; never synced |
| `quietHeld` | `HeldEvent[]` | worker | Events quiet hours held for the digest; newest 50, a day at most |
| `sync` | `SyncState` | panel, worker | Whether this device mirrors settings; device-local |

Other storage: `chrome.storage.session` keys `notified` (event id → URL, newest 300) and `inbox`
(the fast lane's `Last-Modified`, next check, off flag, tagged with `auth.createdAt`);
`chrome.storage.sync` key `settings` (the mirrored copy, at most 8 KB, written only while `sync`
is on). Sign-out removes `auth`, `snapshot`, `pollState`, `teams`, `panelState` and `quietHeld`;
`settings` and `prLocal` stay (no secrets, no account data beyond PR ids), minus seen facts.

Web Locks (origin-wide, shared by panel and worker; none is reentrant):

| Lock | Serializes |
|---|---|
| `prowl:poll` | Polls, consulted-card reads and the fast lane |
| `prowl:session` | Sign-in, sign-out and every account-dependent write (`withSignedIn`); GitHub reads stay outside |
| `prowl:storage:<key>` | `updateItem` read-modify-write; skips unchanged values |
| `prowl:badge` | Badge repaints, each reading storage inside the lock |

### Snapshot

`Snapshot` (`src/lib/model.ts`) is everything a poll produced. Optional fields read as empty when
absent (older snapshots).

| Field | Meaning |
|---|---|
| `fetchedAt`, `viewer` | When and for whom. A snapshot of another login is never a diff baseline. |
| `pullRequests` | id → `PullRequest`; merged or closed PRs stay one poll, in no section |
| `sections` | section id → ordered PR ids; a PR may be in several; `your_turn` has no entry |
| `sectionCoverage` | Per section: `hasMore`, `partial`, `stale` and per-query cursors and totals |
| `sectionsPending` | Sections not yet searched in a progressive publication |
| `sectionScopes` | Section id → fingerprint of what its search asked for (`sectionScopes(settings)`) |
| `sectionErrors` | Section id → why it could not load (invalid query, refused search, SAML, missing scope) |
| `teamRequests` | PR id → keys (`org/slug`) of the viewer's teams asked to review it |
| `settledChecks` | PR id → last non-pending check state, for PRs whose checks are pending now |
| `ciOutcomes` | PR id → observed CI outcome ordinal (all current PRs, at most 200 absent ones) |
| `mergeStateAt` | PR id → when its merge facts were actually read |
| `mergeStateDue` | PR ids whose merge facts are aged, deferred or unread |

### Poll outcome

`pollState` is written twice per poll: `inFlight: true` with `lastAttemptAt`, then the outcome
(helpers in `src/lib/time/backoff.ts`, failures in `recordPollFailure`, `pollState.ts`).

| Outcome | `nextAllowedAt` | Other |
|---|---|---|
| success | `resetAt` when fewer than 100 points remain, else null | failures 0, `lastError` null, `lastSuccessAt` |
| `rate_limited` | later of `resetAt` and now + `retryAfterSeconds` | failures + 1 |
| `unauthorized` | null | both alarms cleared: only an explicit poll tries again |
| any other error | now + `interval × 2^failures`, at most 30 min, minus up to 25% jitter | failures + 1 |

Waits are capped at one hour, and a stored wait longer than that is ignored (the clock went
back). A failure that is not a `GitHubError` (a bug) is stored as `server` with a generic message;
details go to the console. A stored `inFlight: true` seen by a skipped poll is stale (the worker
stopped mid-poll) and is reset.

### Events

`diffSnapshots(prev, next, viewerLogin)` (`src/lib/diff/diffSnapshots.ts`) returns events oldest
first. Ids are `<pr id>:<type>:<key>` and never include the poll time, so a repeated poll yields
the same ids for the notifier to dedupe.

| Event | When (prev → next) | `actor` | `at` | Id key |
|---|---|---|---|---|
| `ci_failed` | checks become `failure`, or are `failure` on a new head | null | `fetchedAt` | head SHA + CI outcome ordinal |
| `ci_passed` | checks `success` after CI last concluded `failure` (`settledChecks`) | null | `fetchedAt` | head SHA + CI outcome ordinal |
| `approved`, `changes_requested`, `review_new` | a new review id, state approved / changes requested / commented | reviewer | `submittedAt` | review id |
| `comment_new` | `commentCount` grows and the latest issue comment is newer | commenter | its `createdAt` | its `createdAt` |
| `ready_to_merge` | `awaitsMerge` turns true (ready, and neither auto-merge nor a queue merges it) | null | `fetchedAt` | head SHA |
| `merged`, `closed` | `open` → merged / closed | `closedBy` | `updatedAt` | head SHA |
| `review_requested` | `whoseTurn` becomes `you` for `review_requested` | null | `updatedAt` | `updatedAt` |
| `your_turn` | `whoseTurn` becomes `you` for any other reason; carries `reason` | null | `fetchedAt` | reason + since |

Rules:

- No events for a null `prev` (first poll after sign-in, including its progressive
  publications) or a `prev` of another account. Events caused by the viewer are dropped; logins
  compare case-insensitively.
- A PR only in `prev` gives nothing (it left the scope). A PR only in `next` gives at most its turn
  event, and only when it *arrived*: GitHub updated it after `prev` (the earlier of
  `prev.fetchedAt` and the newest `updatedAt` it read, so a fast local clock hides nothing) and a
  section that has it ran with the same `sectionScopes` fingerprint in `prev`. A PR that appears
  because a section, query, filter or limit changed is not news.
- The CI ordinal (`carryCiOutcomes`) increments on each observed failure or recovery and survives
  restarts and scope changes, so a repeated outcome on the same SHA gets a new id without poll
  times. Progressive publications recompute from the poll's baseline, so it never advances twice.
- `ci_passed` compares with the state CI last *concluded* (`carrySettledChecks`): failure →
  pending → success gives one `ci_passed`, success → pending → success none.
- `comment_new` needs a newer latest issue comment because `commentCount` also counts review
  comments, which the review events report.
- Turn events are emitted beside the event that caused them; `filterEvents` shows one of the two
  (see [Notifications](#notifications)).

### Turn reasons

`whoseTurn(pr, viewerLogin, teams)` (`src/lib/turn/whoseTurn.ts`, pure, no GitHub read) returns
`{ owner, reason, since }`. It is the one rule behind the Your turn section, the card's turn chip,
the `turn` badge and the turn events. The first match wins:

| PR | Reason | Owner |
|---|---|---|
| any | `closed`, `draft` | none |
| viewer's own | `ci_failed` (`failingChecksBlock`: a failure under `unstable` is optional and falls through) | you |
| | `changes_requested` (after the last push; a bot's too) | you |
| | `conflicts` | you |
| | `feedback`: a non-bot review or issue comment (`lastHumanComment`) newer than the last push and the viewer's latest reply | you |
| | `in_merge_queue`; ready with auto-merge on: `auto_merge` | none |
| | ready: `ready_to_merge` with write access, else `waiting_on_merge` | you / them |
| | reviewed, `behind`, `viewerCanUpdate`: `update_branch` | you |
| | checks pending: `waiting_on_checks` | them |
| | reviewed, `blocked`, unresolved threads: `unresolved_threads` (a heuristic; the card names the real blocker) | you |
| | any merge fact `unknown`: `merge_unknown` (never counted as stuck) | none |
| | otherwise `waiting_on_reviewers` ("stuck" after two days, `STUCK_MS`) | them |
| someone else's | review asked of the viewer: `review_requested` | you |
| | the viewer requested changes and a push followed: `re_review` | you |
| | one of the viewer's teams asked (`snapshot.teamRequests`): `team_review` | team |
| | otherwise `waiting_on_author` | them |

"Last push" is the head commit's `committedDate`, so a force-push of an old commit can read as
older than it is. `yourTurnIds(snapshot)` lists the PRs of every other section where the owner
is `you`, shown in the list's sort order like every section; the Your turn section is never searched.

## Invariants

- **One GitHub origin.** Every request goes to `env.apiUrl` (or `env.webUrl` for the device flow);
  every URL opened goes through `isGitHubUrl` (`openGitHubUrl` in the panel, the notification
  click in the worker). The manifest asks for nothing that reads pages (see
  [Site access lock](#site-access-lock)).
- **The token never leaves `auth`.** Client errors mask it in GitHub's messages and drop
  `cause`, so nothing fetch threw can leak it.
- **Writes are pinned to the head the user saw.** Merge, auto-merge, enqueue and branch update pass
  the polled `headSha` as `expectedHeadOid`; approve passes it as `commitOID`. GitHub refuses
  when the branch moved, so commits nobody looked at are never merged.
- **No write survives a sign-out.** Every account-dependent worker write runs in
  `withSignedIn(auth, …)` under `prowl:session`: if the stored token changed, the write is skipped
  and the poll restarts for the new account or cleans up. Panel loaders publish only while
  `auth.value` is their session.
- **Absence is not closure.** A PR missing from a bounded search keeps its local choices; only a
  PR `ProwlNodes` confirmed merged or closed loses them. Snoozes still expire by date.
- **Merge facts never look better than GitHub said.** Unread or unreadable facts are `unknown`,
  which no local fact (checks, reviews) overrides; a missing permission is false; an unknown
  check requirement is never "optional".
- **Nothing is polled per card.** The expanded detail, review threads, branch rules and AI input
  are read on demand from the panel and never stored.
- **Listeners register synchronously** in `register.ts`; the worker uses no `import()` and no DOM.
  Nothing that matters lives in worker memory: the schedule is the alarms, the rest is storage.
- **Every alarm stops together.** Whatever stops polling (sign-out, a rejected token) clears both
  `poll` and `inbox` (`clearAlarms`); every poll that runs recreates missing ones, since Chrome
  may drop alarms on restart.

## GitHub API usage

- GraphQL reads, each a named operation: `ProwlSearch` (`TEAM_SEARCH_QUERY` adds team fields for
  the team section), `ProwlMergeState`, `ProwlNodes` (`queries.ts`), `ProwlPullRequestDetail`
  (`detailQuery.ts`), `ProwlReviewThreads` (`threads.ts`), `ProwlPullRequestText`
  (`fetchPullRequestText.ts`), `ProwlFailedSuites` (`maintenanceActions.ts`), `ProwlViewer`
  (`auth/pat.ts`). Every read ends with `rateLimit { limit remaining resetAt cost }`.
- GraphQL writes: see [Actions](#actions).
- REST, where GraphQL has no equivalent: `GET /user` (scopes in `x-oauth-scopes`, token expiry),
  `GET /user/teams` (GraphQL has no "my teams" across organizations), `GET /notifications`
  (conditional, the fast lane), `GET /repos/{o}/{r}/rules/branches/{branch}` (on expand),
  `POST .../actions/runs/{id}/rerun-failed-jobs` and `POST .../check-suites/{id}/rerequest`,
  `PUT .../pulls/{n}/merge-async` and `GET` on its operation.
- The device flow posts to `{webUrl}/login/device/code` and `{webUrl}/login/oauth/access_token`
  (scope `repo read:org`).
- Every `Team` field needs `read:org` and would fail the whole query for a `repo`-only token, so
  only `TEAM_SEARCH_QUERY` selects one, and a refusal retries the shared query.

### GitHub client

`createGitHubClient({ token, apiUrl, fetch? })` (`client.ts`) returns `graphql`, `rest` and
`restResponse` (with headers). It sends `Authorization: Bearer`, `X-GitHub-Api-Version`
(`2022-11-28`, or a request's `apiVersion`), a 20 s timeout and `cache: 'no-store'`; it does not
retry (the poller owns backoff) and throws only `GitHubError` (`kind`, `status`, `resetAt`,
`retryAfterSeconds`). A REST call lists the non-2xx statuses that answer it (`accept`: 304, 409).

| Response | Kind |
|---|---|
| 401 | `unauthorized` |
| 429; 403 with `x-ratelimit-remaining: 0`, `retry-after` or a "rate limit" / "abuse detection" message | `rate_limited` |
| other 403, 451 | `forbidden` |
| 404, 410 | `not_found` |
| other 4xx | `validation` |
| 5xx, unusable 2xx body, non-2xx below 400 | `server` |
| fetch rejects, body fails, timeout | `network` |
| GraphQL `errors`: `RATE_LIMITED`, `FORBIDDEN` / `INSUFFICIENT_SCOPES`, `NOT_FOUND`, `UNPROCESSABLE`, other | `rate_limited`, `forbidden`, `not_found`, `validation`, `graphql` |

`retryAfterSeconds` defaults to 60 when GitHub gave neither a reset nor `retry-after` (its advice
for secondary limits). GraphQL answers 200 even when a field failed: `graphql` throws on the
first error unless the read passes `{ partial: true }` (searches, `nodes(ids:)`, the detail),
which keeps the data that came back; authentication and quota errors always throw. Mutations are
strict, since their payload is null when they fail.

### Searches

`src/lib/github/search.ts` turns a `Section` into a search string. Every query starts with
`is:pr` (AND / OR / NOT combine words, never qualifiers, so it cannot be OR-ed away).

| Section | Query |
|---|---|
| `authored` | `is:pr is:open author:@me archived:false` |
| `review_requested` | `is:pr is:open user-review-requested:@me archived:false` |
| `team_review_requested` | `is:pr is:open team-review-requested-user:@me archived:false` (one search for all teams) |
| `mentioned` | `is:pr is:open mentions:@me archived:false` |
| `assigned` | `is:pr is:open assignee:@me archived:false` |
| `custom` | `is:pr <query>` |
| `your_turn` | never searched |

- `fetchPullRequests` appends `sort:updated-desc` unless a custom query has its own `sort:`, so
  the PRs kept are the most recently updated.
- `buildSearchQuery` appends `repo:` / `user:` for `repoInclude` and `-repo:` / `-user:` for
  `repoExclude`; a custom query with its own `repo:` / `org:` / `user:` keeps it.
  `filterByRepo` enforces both lists client-side (case-insensitive, exclude wins) and is the
  source of truth: GitHub treats a scope the exclusions cancel out as no scope at all.
- `validateCustomQuery` refuses an empty query, `is:issue` / `type:issue` / `-is:pr`, operators
  between qualifiers only, more than 5 operators or 256 characters of words (GitHub answers 422).
  An invalid custom section is never sent.
- Team section: `teamEvidence.ts` intersects the requested teams with discovered membership
  (parents included) and drops a PR only when membership and requests are complete and every
  requested team of the viewer is in `unfollowedTeams`; missing evidence never excludes a PR.

### Bounded scans and partial results

- A section reads pages of 25 (`PAGE_SIZE`, `fetchSearch.ts`) until `maxPerSection` PRs are kept,
  scanning at most `min(500, max(100, 5 × maxPerSection))` nodes and 20 requests, so pages the
  repository filters reject do not use up the limit. Coverage records whether GitHub has more.
- A search GitHub refuses (`validation`, `not_found`, `forbidden`, `graphql`) or gives up on fails
  its section only (`sectionErrors`); the poll fails when every search did. Token, quota and
  network failures throw.
- A failed page, a stuck cursor or a refused search keeps the pages read plus the section's
  cached members (`preserve`), marked `stale`. Unreadable nodes (SAML) keep nothing; the notice
  says why. A null node in `ProwlNodes` (deleted PR) is skipped.
- Should GitHub drop the stack field, the search repeats without it (`withoutStacks`): a change to
  that feature costs the stacks, never the list.
- Missing open PRs go through `ProwlNodes`, 100 ids per query: merged or closed ones stay one
  poll with `state` and `closedBy` (`mergedBy`, else the latest `ClosedEvent` actor); still-open
  ones only stopped matching and are dropped.

### Mapping

`mapPullRequest.ts` is the only reader of raw PR JSON. Rules that are contracts:

- **Checks** come from `checkRunCountsByState` + `statusContextCountsByState`, never
  `statusCheckRollup.state`. failed: FAILURE, ERROR, TIMED_OUT, STARTUP_FAILURE, ACTION_REQUIRED;
  pending: PENDING, EXPECTED, QUEUED, IN_PROGRESS, WAITING, REQUESTED; passed: SUCCESS; anything
  else neutral. `running` counts only IN_PROGRESS / QUEUED runs and PENDING statuses (what the CI
  watch follows). State: failure, else pending, else success, else none.
- **Enums** are lower-cased when known, else `unknown` (`state`: `open`). A null `reviewDecision`
  is `none` (no review required), so an unrecognized value is never read as "no requirement".
- **Bots**: `isBot` when `__typename` is `Bot` or the login ends with `[bot]`.
- `lastComment` is the latest issue comment; `lastHumanComment` the latest non-bot one of the
  last 5 (the search reads 5 so a CI report after a question does not hide it).
- `lastCommitAt` is the head commit's `committedDate` (renewed by rebase, amend, update branch).
- `viewerCanMerge` is `viewerPermission` `WRITE`, `MAINTAIN` or `ADMIN` (GraphQL has no
  `viewerCanMerge`, and `viewerCanUpdate` is also true for an author without write access).
- `requestedReviewers` holds users, bots and mannequins, never teams.
- Labels with a color that is not six hex digits get `NEUTRAL_LABEL_COLOR`.

### Merge facts

`reviewDecision`, `mergeable`, `mergeStateStatus`, `viewerCanUpdate` and the three
`viewerCanMergeAsAdmin` / `EnableAutoMerge` / `DisableAutoMerge` permissions are out of the
search: GitHub evaluates branch rules for each on every read, about half a second per PR on busy
repositories, against its 10 s limit. `ProwlMergeState` (`fetchMergeState.ts`) reads them:

- 10 PRs per request, at most 20 per poll, for PRs new, changed in the search, unknown or read
  over 15 minutes ago (one hour for unchanged snoozed PRs). Order: consulted cards, cards on
  screen, other unsnoozed PRs, snoozed PRs, oldest read first; 2 of the 20 slots go to the oldest
  pending so hints cannot starve the rest. Deferred PRs keep their facts and date and are listed
  in `mergeStateDue`.
- A date never crosses a change of the PR's search data (`sameSearchFacts`). Facts cross only a
  change that cannot move GitHub's verdict (a comment, label, title or requested reviewer:
  `carriedMergeFacts`), so a ready PR does not leave Your turn and come back as news; a new head,
  base, check, review, conversation count or draft flag starts it `unknown`.
- `headRefOid` is selected so facts for another head are dropped. A same-head `UNKNOWN` keeps the
  carried facts and leaves the PR due. A response with errors leaves its PRs unknown and unread.
- A consulted card (`refreshMergeState`, `mergeState.ts`) is moved up in any remaining batch, or
  read alone under `prowl:poll`; facts under a minute old are shared across reopens. It does not
  search, advance `fetchedAt` or ignore waits; only `unauthorized` and `rate_limited` failures
  (`isPollBudgetFailure`) touch `pollState`.

### Pull request detail

`fetchPullRequestDetail(client, id, pr?)` (`fetchPullRequestDetail.ts`) is the read behind an
expanded card, from the panel only, never polled or stored. `ProwlPullRequestDetail` reads every
check context with `isRequired`, following the cursor up to 5 pages (500) so a failure is never
hidden behind 100 passing checks; reviewers; `branchProtectionRule` (null for rulesets or rules
the token cannot see, so "review required" has no count); the merge queue entry; commit titles;
deployments. The branch rules come from `GET .../rules/branches/{branch}` (rulesets only),
intersected with the repository's methods; unreadable rules keep the repository's methods, and
GitHub decides at merge time. The read is partial: a hole leaves that part empty, a PR gone or
hidden throws `not_found`. `mapPullRequestDetail.ts` sorts checks failed, pending, passed, neutral
and reviewers changes requested, requested, approved, commented, dismissed.

### Actions

What the panel changes on GitHub, as named operations so the E2E mock dispatches on them. Each
function takes the client, resolves once GitHub confirmed and throws `GitHubError` otherwise.

| Function | Operation | GitHub call |
|---|---|---|
| `approve(client, prId, body?, headSha?)` | `ProwlApprove` | `addPullRequestReview`, `APPROVE`, `commitOID` |
| `requestChanges(client, prId, body, headSha?)` | `ProwlRequestChanges` | `addPullRequestReview`, `REQUEST_CHANGES`, message required |
| `comment(client, prId, body)` | `ProwlComment` | `addComment`: a conversation comment, not a review |
| `mergePullRequest(client, prId, { method, headSha, title? })` | `ProwlMerge` | `mergePullRequest`, `expectedHeadOid`, `commitHeadline` (not for rebase) |
| `setAutoMerge(client, prId, method \| null, headSha, title?)` | `ProwlEnableAutoMerge` / `ProwlDisableAutoMerge` | `enablePullRequestAutoMerge` (with `expectedHeadOid`) / `disablePullRequestAutoMerge` |
| `enqueuePullRequest` / `dequeuePullRequest` | `ProwlEnqueue` / `ProwlDequeue` | `enqueuePullRequest` (with `expectedHeadOid`) / `dequeuePullRequest` |
| `rerunFailedChecks(client, prId)` | `ProwlFailedSuites`, then REST | `rerun-failed-jobs` per failed Actions run, `rerequest` for other failed suites; up to 5 pages of 50 suites before any restart |
| `setDraft(client, prId, draft)` | `ProwlConvertToDraft` / `ProwlMarkReady` | `convertPullRequestToDraft` / `markPullRequestReadyForReview` |
| `updateBranch(client, prId, headSha, method)` | `ProwlUpdateBranch` | `updatePullRequestBranch`, `MERGE` or `REBASE`, `expectedHeadOid` |
| `fetchReviewThreads(client, prId)` | `ProwlReviewThreads` | read on demand, up to 5 pages |
| `resolveThread` / `replyToThread` | `ProwlResolveThread` / `ProwlReplyThread` | `resolveReviewThread` / `addPullRequestReviewThreadReply` |
| `mergeStackUpTo(client, top, { method, queue })` | REST (`stackMerge.ts`) | `PUT .../pulls/{n}/merge-async` (API 2026-03-10), then polls the operation for a minute; `merged`, `enqueued` or `pending` |

- Messages are trimmed; an empty one or one over 65,536 characters fails as `validation` before
  any request. A payload without the created review or comment, or a merge whose PR is not
  `merged`, is a `server` error, so it never reads as done.
- Stacks merge only through `merge-async` (the GraphQL merge mutations refuse stacked PRs). It
  pins only the top's head, so `MergeDialog` refuses once when any listed head moved in the
  snapshot. A 409 names an operation already pending, which Prowl follows as its own.
- The panel runs every write through `runPrAction` (`state/prActions.ts`): one action per PR at a
  time, a toast or the dialog's own error, then a `change` poll; an outcome that arrives after
  another account signed in is dropped.

### Query cost

The one place for these figures: code comments point here. GitHub counts the requests every
connection could need, divides by 100 and rounds; it prices a page by its `first` arguments, not
by what it returns. `rateLimit.cost` in each response gives the real figure.

| Query | Requests | Points |
|---|---|---|
| `ProwlSearch`, page of 25 | 1 + 25 × 8 connections (labels, latestReviews, reviewRequests, reviewThreads, comments, commits, contexts, stack entries) = 201 | about 2 |
| `ProwlMergeState`, 10 ids | 1 (no connection) | 1 |
| `ProwlNodes`, 100 ids | 1 + 100 (timelineItems) = 101 | 1 |
| `ProwlPullRequestDetail`, one page, on expand | 1 + 6 (latestReviews, reviewRequests, firstCommit, commits, contexts, deployments) = 7 | 1 |
| `ProwlReviewThreads`, one page, on demand | 1 + 1 + 100 (latest comments) + 100 (opening comment) = 202 | about 2 |
| `ProwlPullRequestText`, on demand | 1 + 4 (comments, reviews, commits, contexts) + 50 (annotations) = 55 | 1 |

Reading the last 5 comments instead of 1 costs nothing: the price counts connections, not nodes.
With the defaults (two searched sections, Your turn needs none, up to 50 PRs each, every
2 minutes) a poll costs 4 points when each section fits one page and 8 when both are full: 120
to 240 points an hour (2.4% to 4.8% of 5,000). Four sections of 100 every 2 minutes (32 a poll)
stay under 1,000. `ProwlMergeState` adds about a point per 10 changed PRs. `/user/teams` and
`/notifications` spend the REST budget, a separate pool; a 304 from the inbox is free. Fast-lane
polls cost as much as a scheduled poll, at most one a minute for inbox news and one every
2 minutes for the CI watch.

## Service worker

### Inbox fast lane

The `inbox` alarm (every minute) runs `checkFastLane` (`fastLane.ts`). It first asks the cadence
policy: during a wait or after a rejected token it asks GitHub nothing.

- `checkInbox` (`src/lib/github/notifications.ts`) sends `GET /notifications` with the last
  `Last-Modified` as `If-Modified-Since`, no more often than GitHub's `X-Poll-Interval` (counted
  from the alarm's scheduled time) and only on a list at least a minute old (`inboxDue`: deferred,
  not lost, since the next read asks with the same date). The first check of a session only
  records the date.
- The inbox lists every unread thread, so only a PR thread updated after the previous
  `Last-Modified` counts, and only one the list could show: in a repository of the snapshot
  (`listedRepos`) or for a reason a preset section searches (`author`, `review_requested`,
  `mention`, `assign`). Then it asks for an `inbox` poll.
- Fine-grained tokens cannot read the inbox: a 403 or 404 turns the lane off for that sign-in's
  browser session. A 401 is recorded like a poll's (`recordPollFailure`). A rate limit backs off
  only the lane.
- The 304 relies on the Fetch standard: a hand-set `If-Modified-Since` with `cache: 'no-store'`
  bypasses the HTTP cache, so GitHub's 304 reaches the worker as a 304
  (`tests/e2e/cadence.spec.ts`). That it costs no points is documented, not yet measured live
  ([status.md](status.md)).
- The same alarm asks for a `ci` poll while `ciWatched`: CI *running* (not merely expected or
  waiting) on one of the viewer's own open listed PRs that changed in the last hour. Only their
  own, because CI decides the turn only for the author; otherwise an active team would keep the
  fastest cadence forever. With a 2-minute interval it adds nothing.

### Teams

`teams` (`TeamsState`) is `{ login, fetchedAt, teams, error, incomplete? }`. `src/lib/github/teams.ts`:

- `fetchViewerTeams`: `GET /user/teams`, pages of 100 up to `MAX_TEAMS` (200, two pages), each
  team plus its parent (a request to a parent reaches child teams' members). Hitting the bound
  marks membership `incomplete`, which never excludes a PR.
- `teamsDue`: no list, another account's, older than 24 h, or a failed attempt older than 1 h.
- `discoverTeams`: a 403 or 404 for a token without `read:org` becomes `missing_scope` with the fix
  in its message. `unauthorized`, `rate_limited` and `network` stop the poll before any search.

### Notifications

`notifyEvents(events, settings.notifications, prLocal)` (`notifier.ts`) runs at each publication
and never rejects.

1. `filterEvents` (`src/lib/notify/filterEvents.ts`) drops everything when notifications are off,
   then events whose type is off and those of a muted or snoozed PR, then a `your_turn` whose
   reason a kept event of the same PR already tells (`TOLD_BY`). Quiet hours (`isQuietNow`: local
   time, start inclusive, end exclusive, may wrap midnight) hold events in `quietHeld`; the first
   poll after the window shows them as one `digest:<time>` notification, filtered again.
2. Ids already in `notified` are dropped.
3. Up to 3 events get one notification each (id = event id, buttons Open and Snooze 1 h); more
   become one `summary:<time>` notification without buttons.
4. Reported ids go to `notified` with their URL (a summary or digest: `<webUrl>/pulls`). A click
   opens that URL only when it is on `env.webUrl`.

### Badge

`computeBadge` (pure) and `updateBadge` (`badge.ts`) derive the badge from `snapshot`, `prLocal`
and `settings` alone, so any context may change those keys. Modes: `turn` (default, the PRs where
it is the viewer's move), `attention` (failing CI, changes requested, conflicts or `awaitsMerge`),
`unseen` (activity newer than `prLocal.seen` or facts different from `seenFacts`) and `off`.
Snoozed PRs and PRs outside every section never count; muted ones do. Text is the count, empty for
0, `99+` above 99. The color is danger (`#c2272d`) when a counted PR has red CI or changes
requested, else accent (`#007a6d`); a unit test keeps both equal to the tokens. It repaints at
each publication, at worker start, and on any change of the three keys (`watchBadge`). A snooze
that ends is noticed at the next poll's prune: no alarm is created for it.

### Settings sync

`sync.ts` (off by default): while `sync.enabled`, `settings` is mirrored to `chrome.storage.sync`
key `settings` and changes from other devices are applied through `normalizeSettings`. Turning it
on adopts an existing synced copy. Writes happen only when the copies differ, which stops the
echo. The synced copy also carries the legacy hiding keys, off, for older Prowl versions.

## Side panel

- `state/store.ts` holds one signal per storage key; `hydrateStore()` subscribes, reads every key
  once and flips `hydrated` before the first render. The panel never writes a signal: storage
  changes arrive through `onChanged`.
- Hash routes (`state/router.ts`): `#/` list, `#/settings`, `#/onboarding`; signed out is always
  onboarding. After a route change `<main>` takes focus.
- Panel state read for one account resets when the account changes (`onAccountChange`,
  `state/store.ts`): expanded cards and details (`state/prDetail.ts`), review threads, on-device
  AI. Written review drafts (`state/reviewDrafts.ts`) live in memory only, clear when the login
  changes, and are never stored or sent without a click.
- A card's detail reloads when `detailKey(pr)` changes (activity, check counts, merge facts);
  merge controls read `mergeDetailOf` (`state/loadDetail.ts`), which keeps the previous detail
  while a reload for the same head, base and methods is pending, so a poll neither hides the
  buttons nor closes an open dialog.
- Merging has one model (`components/mergeTarget.ts`: `MergeTarget`, `mergeVerbs`, `mergePlan`,
  `sendMerge`) and one `MergeDialog`, for a lone PR and a stack's ready run alike. "Merge without
  waiting" needs `viewerCanMergeAsAdmin` and is never offered on a merge-queue branch.
- Unseen: cards 60% visible for 1.5 s send `markSeen`; the worker drops versions superseded since.
- `StatusBanner` (`describeStatus`, `StatusBannerModel.ts`, pure) shows at most one banner from
  `pollState`, the snapshot age and token expiry, and never hides the list.
- Settings save at once through `saveSettings(patch | updater, { refresh })`; `refresh` sends one
  `change` poll 800 ms after the last edit. An interval change sends nothing: the worker's
  settings subscription recreates the alarm.
- The keyboard command `open-panel` is answered in `register.ts` by `chrome.sidePanel.open`
  before any await (the shortcut is the user gesture it needs).

## Auth

The token lives only in `chrome.storage.local` under `auth`. User-facing steps and the token
permissions are in [auth.md](auth.md).

- **PAT**: `validatePat` (`auth/pat.ts`) refuses anything but letters, digits and `_` (nothing odd
  reaches a header), then runs `ProwlViewer` and `GET /user` in parallel. Token type comes from
  the prefix (`ghp_`, `github_pat_`, `gho_`); scopes from `x-oauth-scopes` (empty for
  fine-grained); `expiresAt` from `GitHub-Authentication-Token-Expiration` (null: never; absent:
  unknown). Warnings: classic without `repo`, without `read:org`, any fine-grained token (no
  Checks permission exists for them, so check runs may be missing).
- **Device flow** (`auth/deviceFlow.ts`, `views/DeviceFlow.tsx`), only with a build-time
  `PROWL_GITHUB_CLIENT_ID` (public, no secret). The click first requests the optional
  `github.com` host permission (Chrome only prompts inside the gesture), then requests a code and
  polls for the token, honouring `interval` and `slow_down`. It lives in the panel: closing it
  ends the flow.
- `completeSignIn` (`state/session.ts`) stores `auth` under the session lock, drops another
  login's snapshot and panel state and the stored teams, then sends a `change` poll. `signOut`
  removes the account's keys (see [Storage keys](#storage-keys)), sends `signedOut` and gives
  back the `github.com` permission.

## Site access lock

Prowl cannot read or change the pages a user visits: the manifest asks for `sidePanel`,
`storage`, `alarms`, `notifications`, the host `api.github.com` and the optional host
`github.com`, plus the `commands` key. `tests/fixtures/manifestLock.ts` holds that list and the
allowed top-level keys; `tests/unit/siteAccess.test.ts` checks both builds' manifests, the docs
and `src/` (only `chrome.tabs.create`, no page-reading API); `tests/e2e/permissions.spec.ts`
checks the loaded extensions. A deliberate change edits the lock, `docs/privacy.md` and
`docs/decisions.md` together.

## Testing

- Unit: Vitest + happy-dom + the `chrome` fake (`src/test/chrome.ts`), colocated.
- Contract: `tests/unit/githubSchema.test.ts` validates every exported GraphQL operation against
  `tests/fixtures/github-schema.graphql` (`pnpm schema:update`; a weekly workflow checks the live
  schema). Deprecated fields fail it.
- E2E: `pnpm e2e` builds `dist/` and `dist-e2e/`; Playwright loads `dist-e2e/`, whose URLs point
  at the mock server on `http://127.0.0.1:4010` (`PROWL_E2E_PORT`). Only `permissions.spec.ts`
  loads `dist/`. Every screen gets an axe check; only `pnpm screenshots` writes
  `docs/screenshots/` (2x).

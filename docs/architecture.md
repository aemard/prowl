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
| `src/lib/notify/` | `filterEvents` (which events notify) and the notification texts (`messages.ts`). Pure. | 80% |
| `src/lib/badge/` | `computeBadge(snapshot, prLocal, mode, now)` → text, tooltip and color flag of the toolbar badge. Pure. | 80% |
| `src/lib/url.ts` | `isGitHubUrl`: the one allowlist for URLs Prowl opens (worker and panel) | 80% |
| `src/lib/time/` | Relative time (`formatRelativeTime`), quiet hours (`quietHours.ts`), backoff (`backoff.ts`) | 80% |
| `src/background/` | Service worker wiring: `register.ts` (listeners), `poller.ts`, `messages.ts` (router), notifier, badge; see [Service worker](#service-worker) | 80% |
| `src/sidepanel/` | UI: `App.tsx`, `state/`, `views/`, `components/`, `components/ui/` (design system) | 80% |
| `src/styles/` | `tokens.css` (design tokens, light/dark), `base.css` | n/a |
| `src/test/` | `chrome.ts` fake used by every unit test | excluded |
| `tests/fixtures/` | Builders for GitHub-shaped GraphQL nodes, shared by unit tests and the E2E mock | n/a |
| `tests/e2e/` | Playwright specs, fixtures, `mock-github/` server | n/a |
| `site/` | Astro website for GitHub Pages (`pnpm --filter site build`, base `/prowl/`). Imports `src/styles/tokens.css`, `src/assets/logo.svg` and `docs/screenshots/` at build time and renders `docs/auth.md`, `docs/privacy.md`, `CHANGELOG.md` and `CONTRIBUTING.md` as pages; ships no JS. `pnpm --filter site lighthouse` (also in CI) fails below 95 in any Lighthouse category on any page | n/a |

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
7. Notifier (see [Notifications](#notifications)) drops events already reported, filters the
   rest (per-event toggles, mute, snooze, quiet hours) and creates `chrome.notifications`.
   Clicking opens the PR.
8. The badge repaints from the snapshot + local state (see [Badge](#badge)).
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
  fetched only when a PR is expanded (`query ProwlPullRequestDetail`, see
  [Pull request detail](#pull-request-detail)).

## GitHub client

`src/lib/github/client.ts`: `createGitHubClient({ token, apiUrl, fetch? })` returns
`graphql<T>(query, variables?, { partial? })`, `rest<T>(method, path, body?)` and
`restResponse<T>(method, path, body?)` (`rest` plus the response headers). It runs in the
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
| `defaultMergeMethod` | Repository `viewerDefaultMergeMethod`: the method the viewer used last there, else the repository's own. `merge` for a value the model does not know. |
| `viewerCanMerge` | Repository `viewerPermission` is `WRITE`, `MAINTAIN` or `ADMIN` (GraphQL has no `viewerCanMerge`; `viewerCanUpdate` is also true for an author without write access). False for `TRIAGE`, `READ`, unknown levels and a GitHub App (null). |

Estimated cost (GitHub counts the requests every connection could need, divides by 100 and
rounds; `rateLimit.cost` in each response gives the real figure):

| Query | Requests | Points |
|---|---|---|
| `ProwlSearch`, page of 50 | 1 + 50 x 7 nested connections (labels, latestReviews, reviewRequests, reviewThreads, comments, commits, contexts) = 351 | about 4 |
| `ProwlNodes`, 100 ids | 1 + 100 (timelineItems) = 101 | 1 |
| `ProwlPullRequestDetail`, one page of 100 contexts, on expand only | 1 + 4 connections (latestReviews, reviewRequests, commits, contexts) = 5 | 1 |

The default settings (one section, 50 PRs, every 2 minutes) cost about 120 points an hour of
the 5,000; four sections of 100 PRs every minute stay under 2,000.

## Pull request detail

`fetchPullRequestDetail(client, id)` (`src/lib/github/fetchPullRequestDetail.ts`) is the one read
behind an expanded card. It is never polled and never stored: the panel calls it when a card is
expanded and keeps the answer in memory (see [Side panel](#side-panel)). `query
ProwlPullRequestDetail($id, $after)` is `node(id:) { ... on PullRequest }` with:

- `commits(last: 1)` -> `statusCheckRollup.contexts(first: 100, after: $after)`: every check run
  (`name status conclusion detailsUrl`) and commit status (`context state targetUrl`) with
  `isRequired(pullRequestId: $id)`, plus `totalCount` and `pageInfo`. The fetch follows the cursor
  for up to 5 pages (500 checks) so a failed check is never hidden behind 100 passing ones;
  `checksTotal` keeps GitHub's count so the panel can say "N more checks on GitHub".
- `latestReviews` (with avatars) and `reviewRequests` (users, bots and mannequins; teams stay out
  because every `Team` field needs `read:org`, as in the list query).
- `baseRef.branchProtectionRule { requiredApprovingReviewCount requiresConversationResolution }`,
  which is how "1 approval required" is known. It is null for a branch without a rule, for rules
  that live in rulesets, and where the token cannot see rules; the panel then says "review
  required" without a count.

The read is `partial`: a hole (check runs a fine-grained token cannot read) leaves that part
empty instead of failing reviewers and rules; a PR that is gone or hidden throws `not_found`.
`mapPullRequestDetail` (in `mapPullRequest.ts`) maps to `PullRequestDetail`:

| Field | Rule |
|---|---|
| `checks` | Check run state is its `conclusion` once `COMPLETED`, else its `status`; commit statuses use `state`; the same buckets as the list counts (`passed`, `failed`, `pending`, anything else `neutral`). Failed first, then pending, passed, neutral, GitHub's order inside each. `url` only for http(s) links; `required` from `isRequired`. |
| `reviewers` | One entry per login: the latest review (PENDING and unknown states dropped; a deleted account is `ghost` with no avatar), else `requested`. A reviewer asked again keeps the review state, which is what blocks or allows the merge. Changes requested first, then requested, approved, commented, dismissed. |
| `requiredApprovals` | The rule's `requiredApprovingReviewCount`, null when 0 or no rule is visible. |
| `requiresConversationResolution` | The rule's flag, false without a rule. |

## Actions

`src/lib/github/actions.ts` holds what the panel changes on GitHub, as named operations so the E2E
mock can dispatch on them and each request's variables say what it does. Each function takes the
client and a PR node id, resolves once GitHub confirmed and throws `GitHubError` otherwise.

| Function | Operation | GitHub call |
|---|---|---|
| `approve(client, prId, body?)` | `mutation ProwlApprove` | `addPullRequestReview`, variable `event: APPROVE`, optional note |
| `requestChanges(client, prId, body)` | `mutation ProwlRequestChanges` | `addPullRequestReview`, `event: REQUEST_CHANGES`, message required |
| `comment(client, prId, body)` | `mutation ProwlComment` | `addComment` on the PR's node id: a conversation comment, not a review |
| `mergePullRequest(client, prId, { method, headSha, title? })` | `mutation ProwlMerge` | `mergePullRequest` with `mergeMethod` (`MERGE`, `SQUASH`, `REBASE`), `expectedHeadOid: headSha` and, for a merge or squash commit, `commitHeadline` |

Messages are trimmed; an empty one (and one over GitHub's 65,536 characters) fails as `validation`
before any request is sent. A payload without the new review or comment (no `errors`, but nothing
created) is a `server` error, so it never reads as done. Mutations use strict GraphQL: a failure
throws with GitHub's message, with the token masked by the client. `$oid` of `ProwlMerge` is
required: GitHub refuses with "Head branch was modified. Review and try the merge again." when the
head moved since the panel last saw it, so commits nobody looked at are never merged; the other
refusals (not mergeable, conflicts, required checks or reviews, a merge queue) arrive the same way
and are shown as GitHub words them. A payload whose pull request is not `merged` is a `server`
error. A rebase has no commit of its own, so its `commitHeadline` is dropped. Re-run and the draft
toggle (US-017) add their functions here.

The panel runs them through `runPrAction(pr, name, done, run)` (`src/sidepanel/state/prActions.ts`):
it builds a client for the signed-in token, marks `pendingActions[pr.id] = name` (the signal that
disables the PR's other action buttons; one action per PR at a time), and shows a success toast
(`<done> owner/name#n`) followed by `{ type: 'poll', force: true }`, or a danger toast `<name>
failed: <GitHub's message>` (any error that is not a `GitHubError` becomes "Something went
wrong."). It resolves to whether it worked and never rejects.

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
signed out or stopped) and the badge's own storage listeners (`watchBadge`).

`poller.ts`:

- `poll({ force })` runs at most one poll at a time (an in-memory promise; concurrent callers
  share it) and never rejects. It resolves to `{ snapshot, events }` when a poll ran and
  stored a snapshot, null otherwise. The badge and notifications hook in at the end of the poll
  itself, once per poll, not in its callers.
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
`signedOut` calls `clearSignedOut()`: the `poll` alarm, `pollState`, the badge text, every
notification and the memory of what was reported.

### Badge

The toolbar badge is a pure function of storage: `computeBadge(snapshot, prLocal, settings.badge,
now)` (`src/lib/badge/computeBadge.ts`) and `updateBadge()` (`src/background/badge.ts`), which reads
`snapshot`, `prLocal` and `settings` and sets the badge text, background color and tooltip
(`action.setTitle`). Nothing is kept in memory, so any context may change those keys.

- `attention` (default) counts the open PRs in a section with failing CI, requested changes,
  conflicts (`mergeable: conflicting`) or `isReadyToMerge`; `unseen` counts the PRs in a section
  with `updatedAt` newer than `prLocal.seen` (a PR never seen counts; state does not matter);
  `off` shows nothing. A PR counts once, however many reasons it has. Snoozed PRs never count;
  muted ones do (mute only silences notifications). Merged and closed PRs outside every section
  never count.
- Text is the count, empty for 0 and `99+` above 99. The color is `--color-danger-solid`
  (`#c9222e`) when a counted PR has failing CI or requested changes, else `--color-accent-solid`
  (`#3b4fd8`); a unit test keeps the two constants equal to the tokens. The tooltip is
  `Prowl: 3 pull requests needing attention (2 CI failing, 1 ready to merge)` (reasons are
  counted separately, so they can add up to more than the count), `Prowl: 2 pull requests with
  unseen changes` in `unseen` mode, and plain `Prowl` when empty.
- It repaints after every poll that ran (end of `runPoll`), at worker startup (a browser restart
  drops the badge, and the poll that follows may be skipped), and on every change of `snapshot`,
  `prLocal` or `settings` (`watchBadge`, listeners registered synchronously in `register.ts`):
  a snooze or seen mark written by the panel, a badge mode change, a snapshot removed at sign-out.
  Repaints run one at a time under a Web Lock and each reads storage inside it, so the last one
  always shows the latest state. `clearBadge()` (sign-out) empties it whatever is stored.
- A snooze that ends is noticed at the next poll (the prune writes `prLocal`), at most one
  polling interval late: no alarm is created for it. A failing badge call is logged, never fatal.

### Notifications

`notifyEvents(events, settings.notifications, prLocal)` (`src/background/notifier.ts`) runs at
the end of every poll that ran (never rejects: a failure is logged and the poll result stands).

1. Events whose `id` is already in `notified` are dropped.
2. `filterEvents` (`src/lib/notify/filterEvents.ts`, pure) drops everything when notifications are
   off or `isQuietNow` (`src/lib/time/quietHours.ts`: local time, `start` inclusive, `end`
   exclusive, a window may wrap past midnight, `start === end` is empty), then the events whose
   type is switched off and those of a muted or snoozed PR. Dropped events are not retried
   later and not marked as reported.
3. Up to 3 events become one `basic` notification each (`src/lib/notify/messages.ts`: title says what happened
   and who did it, message is the PR title, context is `owner/name#number`); more than 3 become
   one summary ("5 pull request updates", the first PRs listed). The notification id of a
   single event is its event id; a summary's is `summary:<time>`.
4. Every reported event id is stored in `chrome.storage.session` under `notified` (event id ->
   PR URL, newest 300, cleared with the browser session and on sign-out). That is the dedupe
   (ids repeat for a re-run that fails again on the same commit) and how a click finds its PR.

A click (`notifications.onClicked`, registered in `register.ts`) clears the notification and
opens the stored URL in a tab when it is on the `env.webUrl` origin; a summary has no URL, so
a click only clears it.

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

- **PAT** (classic or fine-grained), pasted in onboarding: `validatePat(token)`
  (`src/lib/github/auth/pat.ts`) trims it, refuses anything but letters, digits and `_` (so
  nothing odd reaches a header), then runs `query ProwlViewer` (`viewer { login avatarUrl name }`)
  and `GET /user` in parallel (`client.restResponse` returns the headers; `x-oauth-scopes` is
  the only place GitHub reports a classic token's scopes). The token type comes from the prefix
  (`ghp_` classic, `github_pat_` fine-grained, `gho_` oauth, else `unknown`); `scopes` is empty
  for tokens whose response carries no scopes header (fine-grained). It returns the `AuthState`
  plus an optional warning, and throws only `GitHubError`; `signInErrorMessage(error)` turns it
  into the text onboarding shows inline (never the token: the client masks it in GitHub's
  messages and our own messages do not contain it).
- **After validation** (`src/sidepanel/state/session.ts`): `completeSignIn(auth, warning)` stores
  `auth`, sends `{ type: 'poll', force: true }` and navigates to the list; a warning is shown as a
  toast ("Signed in as octocat. ..."), for PAT and device sign-ins alike. `signOut()` (account menu, after a confirmation dialog) removes
  `auth`, `snapshot` and `pollState` and sends `{ type: 'signedOut' }`; the worker clears alarms,
  badge and notifications. `settings` and `prLocal` stay (they hold no secrets and no account
  data beyond PR ids).
- **Which token** (the onboarding copy says the same, with links to creation pages whose forms
  are pre-filled through GitHub's template URLs, `TOKEN_URLS`):

| | Classic (recommended) | Fine-grained |
|---|---|---|
| Needs | `repo` (or `public_repo` for public repositories only) | Pull requests R/W, Contents R/W (merge), Actions R/W (re-run failed jobs), Commit statuses R, Metadata R (always granted). Read-only (Pull requests R, Commit statuses R) is enough to follow PRs. |
| Scope of access | Every repository the account can access | **One** resource owner (a user or one organization) and the repositories chosen; not repositories the user only collaborates on from outside an organization |
| Check runs (CI) | Yes | **No**: GitHub has no Checks permission for fine-grained tokens (documented limitation; GitHub support, March 2025: only GitHub Apps get it). Reading a check run through GraphQL answers "Resource not accessible by personal access token"; Prowl's `partial` reads should turn those holes into `checks.state: 'none'` (not verified with a live fine-grained token). Legacy commit statuses work with Commit statuses R. |
| Re-run | Failed jobs and check suites | Failed jobs of GitHub Actions runs (Actions R/W); `check-suites/{id}/rerequest` needs the unavailable Checks permission |

  Sign-in succeeds either way; a classic token without `repo` gets a warning (public
  repositories only) and any fine-grained token a note about CI status. The scopes are stored
  in `AuthState.scopes` so settings can show them. Sources: GitHub Docs "Managing your personal
  access tokens" (limitations list "Using fine-grained personal access token to call the Checks
  API"), "Permissions required for fine-grained personal access tokens" (no Checks section),
  community discussion 129512.
- **OAuth device flow** (`src/lib/github/auth/deviceFlow.ts`, UI in `views/DeviceFlow.tsx`): needs
  an OAuth App client id (`PROWL_GITHUB_CLIENT_ID` at build time; the id is public, there is no
  client secret). Builds without one hide the button and link to `docs/auth.md` instead.
  1. The button's click handler first calls `chrome.permissions.request` for `env.webUrl/*`
     (`https://github.com/*`, an optional host permission; granted already in e2e builds), because
     Chrome only prompts during the user gesture. A refusal is explained inline and nothing is sent.
  2. `requestDeviceCode()` POSTs `client_id` + `scope=repo` (form-encoded, `Accept: application/json`)
     to `{webUrl}/login/device/code` and returns `{ deviceCode, userCode, verificationUri,
     expiresAt, interval }`. The panel shows the code (copy button, `Code expires in m:ss`, cancel),
     and opens `verificationUri` in a tab through `openGitHubUrl`.
  3. `pollForToken(code, { signal })` waits `interval` seconds, then POSTs
     `client_id`, `device_code`, `grant_type=urn:ietf:params:oauth:grant-type:device_code` to
     `{webUrl}/login/oauth/access_token`, repeating while GitHub answers `authorization_pending`
     (`slow_down` adds 5 s to the interval for the rest of the flow). It resolves to the access token, or
     throws `DeviceFlowError` with `reason`: `expired` (`expired_token`, or the code's lifetime ran
     out locally), `denied` (`access_denied`), `unsupported` (`device_flow_disabled`,
     `unauthorized_client`, `incorrect_client_credentials`, `unsupported_grant_type`, an empty
     client id, or a 404), `network` or `server`. Aborting the signal rejects with its reason; the
     panel aborts on cancel and when the view unmounts.
  4. `validateDeviceToken(token)` is `validatePat` (viewer + scopes, a warning when `repo` is
     missing) with `method: 'oauth'`; `completeSignIn(auth, warning)` stores it, polls and shows
     the list, as for a PAT.
  The flow lives in the panel only: closing the panel ends it (the code stays valid at GitHub for
  its 15 minutes, but nothing polls), and the user starts again. Tokens from the flow do not
  expire (OAuth Apps), and sign-out only forgets them locally; the user can revoke Prowl under
  GitHub's "Authorized OAuth Apps" (`docs/auth.md`).
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
  settings / back toggle and the account menu (avatar: GitHub profile, Sign out behind the
  `SignOutDialog` confirmation that Settings reuses). Signed out or before hydration it is the
  brand alone.
- `state/background.ts`: `sendToBackground(BackgroundRequest)` resolves even when the worker has
  no receiver. `openUrl.ts`: `openGitHubUrl(url)` is the only way the panel opens a URL, and it
  refuses anything outside the `env.webUrl` origin.
- Theme: `settings.theme` becomes `data-theme` on `<html>` (`system` removes it, so
  `prefers-color-scheme` applies); `<ToastRegion />` is mounted once in `App`.
- Components in `src/sidepanel/components/ui/` are the design system; feature components
  compose them. One CSS file per component, tokens only (no raw colors).
- List (`views/List.tsx`): sections come from `settings.sections` (enabled ones; a single one has
  no tabs), each tab shows its number of PRs that match the quick filter. PRs are
  `snapshot.sections[id]` -> `snapshot.pullRequests`, filtered and sorted by `settings.sort` in
  `views/ListModel.ts` (title, repo, `#number`, author, label names; every word must match). The
  selected tab and the filter are module signals, so they survive a visit to Settings. States:
  skeleton until the first snapshot (or an error with "Try again" when the first poll failed),
  no sections enabled, no PRs, no matches (Clear filter), and a notice plus a warning on the tab
  for a section in `snapshot.sectionErrors`.
- Unseen: a PR is unseen when `prLocal.seen[id]` is missing or older than its `updatedAt`
  (`isSeen`). The list observes its cards (IntersectionObserver, 60% visible) and, once the same
  unseen cards have stayed on screen for 1.5 s while `document.visibilityState` is visible, sends
  one `{ type: 'markSeen', prIds }`; a scroll, a hidden panel or a new snapshot restarts the wait.
  The worker stores `seen`, and the dot disappears through the storage subscription.
- `PullRequestCard` is a summary plus, when expanded, `PullRequestDetails`. The title is the
  link (`GitHubLink`: `href` only for URLs on `env.webUrl`, click opens through `openGitHubUrl`,
  named "Title, owner/name#n"); the chevron `IconButton` ("Details for Title", `aria-expanded`,
  `aria-controls` while open) is its sibling, never nested in it, and `aria-describedby` points
  to a hidden sentence with every fact the card shows. Row actions (US-018) go beside them in the
  summary: a click on the summary toggles unless it lands on a link or button or ends a text
  selection, and the card's `keydown` handler folds an expanded card on Escape and focuses its
  chevron. Both are native listeners on the `li`, because the card itself is not a control. Chips
  and the sentence come from `components/prStatus.ts` (pure, table-tested; ready-to-merge reuses
  `isReadyToMerge` from the diff engine). The unseen dot comes from `isSeen`, like the badge, and
  `data-pr-id` / `data-unseen` sit on the summary, which is what the seen observer watches (an
  expanded card is as tall as it likes). Relative times take `now` from `useNow` in the list.
- Actions (`components/PullRequestDetails.tsx`, `ReviewActions.tsx`): an expanded card has an
  **Actions** group right after Merge (so it does not move when the detail loads): one wrapping row
  `.pr-actions` of small buttons, to which later actions are added. `ReviewActions` renders
  Approve, Request changes and Comment, each named with the PR ("Approve acme/web#12"). Approve
  is one click (no dialog; GitHub cannot take an approval back, so the toast offers no Undo). The
  other two open a `Dialog` with a required message; a failure closes it, shows the reason in a
  toast (a modal would cover one) and keeps the text for the next try until the card is folded.
  Approve and Request changes are hidden on the viewer's own PRs (GitHub refuses them) and on PRs
  that are not open; Comment is always there. While one action of a PR runs its other buttons are
  disabled, and its dialog cannot be closed or edited. `Dialog` stops Esc from reaching what
  contains it (the card folds on Esc).
- Merge (`components/MergeAction.tsx`, last in the `.pr-actions` row): a "Merge acme/web#12"
  button (primary once `isReadyToMerge`, else secondary) for someone with write access (`viewerCanMerge`) on an open, non-draft PR whose
  repository allows at least one method; it opens a confirmation naming the PR, its title and
  target branch, a `Select` of `allowedMergeMethods` only (starting on `defaultMergeMethod`, else
  the first allowed) and an optional commit title (not offered for a rebase). Focus starts on the
  method, never on the button that merges. It sends `ProwlMerge` with `headSha` of the PR as the
  panel last polled it. Readiness is not enforced by the panel (an admin may bypass rules, and
  GitHub knows better): the Merge group above lists the blockers, and GitHub's refusal comes back
  in a toast after the dialog closed, with the method and title kept for the next try, plus a
  forced poll because a refusal usually means the PR changed (a moved head, new conflicts). On
  success the toast and forced poll follow the usual route: the merged PR is in no search result
  any more, so `ProwlNodes` marks it merged and it leaves the list.
- Expanded cards (`state/prDetail.ts`): `expandedIds` and the per-PR `details` cache are module
  signals, so a card stays open through background refreshes, tab switches and Settings. They
  reset when the token changes or goes away. `loadDetail(pr)` runs when `PullRequestDetails`
  mounts and whenever `detailKey(pr)` changes (activity, check counts, merge facts: a finished
  check does not always touch `updatedAt`); a poll that changes none of them costs nothing. The
  previous detail stays on screen while a newer one loads, an answer overtaken by a newer request
  is dropped, and a failure shows GitHub's message with "Try again" above whatever is cached.
- Merge readiness (`components/mergeReadiness.ts`, pure, table-tested) turns `PullRequest` plus
  the optional `PullRequestDetail` into one line per blocker: draft, "Conflicts with main",
  "Blocked: branch is behind main", "Blocked: changes requested by alice", "Blocked: 1 approval
  required" (or "1 more", or "review required" when the rule is not visible), "Blocked: 2
  required checks failing" (failing checks that are not required only inform), "Waiting for 1
  required check to finish", "Blocked: 3 conversations to resolve", and "Ready to merge" when
  nothing blocks; `blocked` without a known reason says "Blocked by the base branch's rules". It
  works from the list's data alone (generic counts) and sharpens once the detail has loaded, so
  the Merge group shows at once.
- Settings (`views/Settings.tsx`, one scrolling screen of six groups: Pull requests, Refresh,
  Notifications, Appearance, Account, About; `SettingsScope`, `SettingsNotifications` and
  `SettingsAccount` hold the bigger ones, `SettingsModel.ts` the pure copy and the cost estimate).
  Every control saves at once through `saveSettings(patch | updater, { refresh })`
  (`state/settings.ts`, a thin `updateSettings` that toasts when the write fails); the panel
  signals follow through the storage subscription, so a control shows what was stored, not what
  was clicked. Rules:
  - Sections: presets are switches (their id is their kind, `normalizeSettings` keeps them);
    custom sections are added and edited in a `Dialog` whose query goes through
    `validateCustomQuery` (errors shown with the field, focus on the first invalid one), get the
    id `custom-<8 hex>`, and are removed with an Undo toast. `RepoFilter` (include / exclude) takes
    chips validated by `normalizeRepoPattern`, rejects duplicates case-insensitively and announces
    adds and removals in a live region.
  - `refresh: true` (sections, repository lists, results per section) sends one forced poll 800 ms
    after the last change, so the list does not wait for the next alarm. An interval change
    sends nothing: `registerBackground` subscribes to settings and `scheduleAlarm(minutes, true)`
    recreates the alarm (E2E reads `chrome.alarms.get('poll').periodInMinutes`).
  - `NumberField` saves valid whole numbers as typed (interval 1-60, results 1-100) and shows an
    error for the rest; blur shows the saved value again. The Refresh note shows the estimated
    cost in points an hour (`estimatedPointsPerHour`, the formula of the cost table above).
  - Notifications: master switch (greys out the event switches, quiet hours and the test button),
    one switch per `PrEventType`, quiet hours with two `<input type="time">` (a window may cross
    midnight; the note only appears for that or an empty window), and "Send test notification",
    which calls `chrome.notifications.create` from the panel with id `test:<ms>` and
    `icons/icon-128.png`; the worker's click handler finds no URL for that id and just clears it.
  - Account: avatar, login, name, token type, scopes (a fine-grained token says why it has none)
    and Sign out; the token itself is never rendered. About: `chrome.runtime.getManifest().version`
    and three links opened through `openGitHubUrl` (docs folder, `docs/privacy.md`, repository).
- Section tabs scroll sideways when they do not fit; a fade and a chevron at an edge with more
  tabs behind it say so (measured on scroll and resize), and a tab brought into view by the arrow
  keys stays clear of them.

## Testing

- Unit: Vitest + happy-dom + `src/test/chrome.ts`. Colocated `*.test.ts(x)`.
- E2E: Playwright loads `dist-e2e/` (`vite build --mode e2e`) whose API and web URLs point to
  the mock server on `http://127.0.0.1:4010`. Seed auth/settings with the `seedStorage(items)`
  fixture (it writes `chrome.storage.local` from the service worker, so an open panel updates
  live) or `signIn(overrides?)`; drive polls with `poll()` (a forced poll sent from an extension
  page, resolved once it is done); assert on `github.requests` and on
  `chrome.notifications.getAll()` in the worker.
- Every screen gets an axe check; screenshot specs write to `docs/screenshots/`.

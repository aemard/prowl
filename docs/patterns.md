# Codebase patterns

Where things live, which helper to call, the test builders and the gotchas, for anyone changing
Prowl. [architecture.md](architecture.md) explains the design and
[decisions.md](decisions.md) why it is so; this page is working knowledge only. Keep each entry
to a sentence or two that points at a file, and rewrite an entry when it goes stale instead of
appending a newer one.

## Toolchain and gates

- `pnpm verify` is the gate, `pnpm verify:fast` the inner loop; run `pnpm lint:fix` first.
  Node 24, pnpm 12; pnpm settings such as `allowBuilds` (needed by any dependency with an install
  script) live in `pnpm-workspace.yaml`.
- Biome: single quotes, 2 spaces, width 100; 300 code lines per file and 50 per function
  (comments are free). Test and spec files are exempt from the function limit only; split a long
  suite into `name.<behavior>.test.ts` with builders in `name.test-support.ts`.
- Vite 8 uses `build.rolldownOptions`; entries are `src/sidepanel/index.html` and
  `src/background/index.ts`. The E2E build (`dist-e2e/`) points the API and web URLs at
  `http://127.0.0.1:4010` (`PROWL_E2E_PORT` for both build and mock) with client id
  `e2e-client-id`.
- `tests/unit/docPaths.test.ts` fails when a doc cites a `src/`, `tests/`... path that does not
  exist: fix the doc in the same change that moves the file.
- Deprecations: import Preact event and attribute types from `'preact'`
  (`TargetedKeyboardEvent`, `MouseEventHandler`), not the deprecated `JSX.*` aliases.

## Tests

- Unit tests get a fresh `chrome` fake (`src/test/chrome.ts`) before each test:
  `fakeChrome().__state` exposes alarms, notifications, badge, tabs and granted origins, and
  `.emit()` fires its events. Like Chrome, it fires `storage.onChanged` only for real changes.
- Panel unit tests: build stored values with `src/test/panel.ts` (`buildAuth`, `buildSnapshot`,
  `buildSnapshotOf({ sectionId: prs })`, `buildPullRequest`, `buildDetail`), seed storage,
  `await hydrateStore()` inside `act`, and reset module signals (`auth.value`, `location.hash`,
  `expandedIds`, `details`) in `afterEach`. Stub detail reads with `stubDetailFetch`
  (`src/test/githubFetch.ts`).
- Preact tests: wrap `dispatchEvent` and fake-timer advances in `act()`. happy-dom has
  `dialog.showModal()` but no Esc: dispatch `new Event('cancel', { cancelable: true })`.
- GitHub-shaped builders live in `tests/fixtures/` (`github.ts`: `prNode`, `searchResponse`,
  `closedNode`, `nodesResponse`, `detailNode`, `detailResponse`...; `http.ts`; `events.ts`
  `prEvent`; `threads.ts`; `text.ts`; `teams.ts`). `prNode` PRs are authored by the viewer
  (`octocat`): pass `author` for someone else's, `stackEntry` for a stack member.
- E2E fixtures (`tests/e2e/fixtures.ts`): `serviceWorker`, `openPanel(hash)`, `signIn()`,
  `seedStorage()`, `poll()`, `expectNoA11yViolations(page)`, `saveScreenshot(page, name)` and
  `github` (the mock: `onGraphQL(operation, fn)`, `on(method, path, fn)`, `requestsFor(...)`).
  List data is `tests/e2e/helpers/listData.ts`, expanded-card data `helpers/detailData.ts`.
- `poll()` leaves a panel page open that marks cards seen: close `/sidepanel/` pages after it, and
  for later polls send `chrome.runtime.sendMessage({ type: 'poll', reason: 'user' })` from a page.
- Flakes: `expectNoA11yViolations` waits for running animations, so call it after
  `emulateMedia`, never mid theme switch.

## GitHub layer (`src/lib/github/`)

- All HTTP goes through `createGitHubClient` (`client.ts`), which throws only `GitHubError`.
  `graphql` is strict; pass `{ partial: true }` for reads that tolerate holes. REST calls take
  `{ headers, apiVersion, accept }`: `accept` for a non-2xx answer (304, 409), `apiVersion` only
  for an endpoint documented under a newer version.
- Every operation is an exported, named string (`query ProwlX`); `tests/unit/githubSchema.test.ts`
  validates them against `tests/fixtures/github-schema.graphql` (refresh with
  `pnpm schema:update`). A field GitHub may drop goes through a strippable constant
  (`withoutStacks`, retried in `fetchSearch.ts`). End each read with `${RATE_LIMIT_FIELDS}`
  (`rateLimit.ts`); a connection added or removed changes the table in architecture.md, "Query
  cost", the only place with figures.
- Searches: `buildSearchQuery`, `filterByRepo` and `validateCustomQuery` (`search.ts`).
  `fetchPullRequests` is the only reader of raw PR JSON (via `mapPullRequest`); every PR it finds
  goes through `put`, and `preserve` restores cached members only after a cut scan or a refused
  search. Merge facts carry over with their date while `sameSearchFacts` holds and without it
  while `carriedMergeFacts` (`fetchMergeState.ts`) says the change cannot move GitHub's verdict.
- Writes: `reviewActions.ts`, `mergeActions.ts`, `maintenanceActions.ts`, `threads.ts`,
  `stackMerge.ts` (the table is in architecture.md, Actions). A stack merges through
  `mergeStackUpTo` (REST `merge-async`), never `mergePullRequest`.

## Service worker (`src/background/`)

- `poll({ reason })` (`poller.ts`) is the only way to poll: pass the trigger's `PollReason` and let
  `pollVerdict` (`src/lib/time/cadence.ts`) decide; never gate a trigger on age or backoff in the
  caller. Notifications and the badge run once at the end of `runPoll`. The one exception is
  the fast lane's inbox read (`inboxDue`), which defers a read, never a poll.
- Inbox threads in tests: `notificationThread` (`tests/fixtures/notifications.ts`); only a listed
  repository or a section reason (`author`, `review_requested`, `mention`, `assign`) counts.
- Alarms are in `pollState.ts` (`scheduleAlarms`, `clearAlarms`): whatever stops polling clears
  both. `clearSignedOut()` clears alarms, pollState, badge, notifications and the `inbox` state;
  that state is also tagged with `auth.createdAt`, so another sign-in starts afresh.
- Pages may send only `panel`, `user` and `change` polls (`messages.ts`); a message resolves when
  handled.
- Wrap every account-dependent worker write in `withSignedIn(auth, task)`
  (`src/lib/storage/session.ts`); Web Locks are not reentrant, so never nest it, and keep GitHub
  reads outside it.
- Notifications: `notifyEvents` (`notifier.ts`) over the pure `filterEvents` (`src/lib/notify`)
  and `isQuietNow`. The diff always emits turn events; `filterEvents` drops a `your_turn` that
  a kept event of its PR tells (`TOLD_BY`), so filter before the dedupe. Reported ids live in `chrome.storage.session` key `notified`, held events in
  `quietHeld` (`quietDigest.ts`). Test a browser restart with `chrome.storage.session.clear()`
  plus `vi.resetModules()`.
- Badge: `computeBadge` (`src/lib/badge`) is pure; `watchBadge()` (`badge.ts`) repaints on
  storage changes, so the panel only writes storage. In E2E, `expect.poll` the badge after a write.

## Storage (`src/lib/storage/`)

- Never call `chrome.storage.local` directly: use `getItem` / `setItem` / `subscribe`,
  `loadSettings` / `updateSettings`, `updatePrLocal(fn)`. Reads are normalized; read-modify-write
  goes through `updateItem` (a Web Lock shared by panel and worker).
- The legacy hiding keys (`hideStaleAfterDays`, `hideDrafts`, `hideBots`) are not settings:
  normalization drops them, and only `pushSettings` (`src/background/sync.ts`) still writes them,
  off, into the sync copy for older Prowl versions on other devices.
- Compare stored values with `jsonEqual` (Chrome reorders object keys). Optional snapshot fields
  (`sectionErrors`, `teamRequests`, `settledChecks`...) read as empty when absent.
- Domain types: `model.ts` re-exports `modelSettings.ts`; always import from `model`.

## Side panel state (`src/sidepanel/state/`)

- Signals in `store.ts` (`settings`, `auth`, `snapshot`, `pollState`, `prLocal`); `route` /
  `navigate()` in `router.ts`; `sendToBackground()` in `background.ts`; URLs open only through
  `openGitHubUrl()` (`src/sidepanel/openUrl.ts`).
- A component re-renders only when the signals it reads or its props change: call `useNow(ms)`
  in the component that shows a relative time, and read `Date.now()` there.
- Settings change only through `saveSettings(patch | updater, { refresh })` (`settings.ts`);
  pass an updater for arrays and objects so quick edits do not lose each other. Use
  `changePrLimit()` to focus the limit field across the lazy mount.
- Account-local list context (selected section, folded groups) goes through `selectSection` /
  `toggleFolded` (`listContext.ts`), read once per account after hydration.
- Sign-in: `validatePat` (`src/lib/github/auth/pat.ts`) or the device flow
  (`auth/deviceFlow.ts`, `views/DeviceFlow.tsx`, only with `env.clientId`), then
  `completeSignIn` / `signOut` (`session.ts`).

## UI and CSS

- Reuse `src/sidepanel/components/ui/<Name>` (import each module, no barrel) and icons from
  `components/icons`; `docs/design.md` is the reference.
- CSS uses semantic tokens only; `src/styles/tokens.test.ts` fails on raw colors outside the
  token files and on a stale contrast table in `docs/design.md` (it prints the new one).
  Z-index layers are tokens in `src/styles/tokens.css`; `Menu` uses the Popover API top layer.
- Anything fixed near the bottom keeps clear of the section bar: CSS uses
  `var(--app-inset-bottom, 0px)`, JS measures `[data-bottom-bar]`.
- Mount `<ToastRegion />` once and call `showToast`. `Dialog` is controlled and restores focus;
  an action's failure goes in its `error` prop (in-dialog `role="alert"`, `setError` as
  `runPrAction`'s `onError`), never a toast under the modal.
- axe: a `<header>` / `<footer>` inside a `<dialog>` is a nested landmark; use `<div>`. Biome
  rejects `role="group"`: use a labelled list. An outline inside `overflow: hidden` is clipped:
  use a negative `outline-offset`. View headings must not contain "Prowl" (smoke.spec).
- Click-on-summary and Escape on a card are native listeners on the `li`: Biome rejects JSX
  handlers on non-interactive elements, and ignores are not allowed.

## List and cards

- A section's PRs come from `pullRequestsOf(snap, section)` (`views/ListState.ts`), never
  `snap.sections[id]` (Your turn is never searched). Pure filter, sort and `groupByRepo` are in
  `views/ListModel.ts`; snoozed PRs fold through `splitSection`.
- A new section kind is one entry in `KINDS` (`views/sectionKinds.ts`). Bar names are short;
  E2E finds a tab with `getByRole('tab', { name: /^Review/ })`.
- Card chips and accessible names: `pullRequestStatuses` and `describePullRequest`
  (`components/prStatus.ts`); whose turn comes from `whoseTurn` / `turnIn` / `yourTurnIds`
  (`src/lib/turn`), the one rule for section, chips, badge and events. Merge eligibility
  (`isReadyToMerge`, `mergesItself`, `awaitsMerge`) lives in `src/lib/mergeEligibility.ts`, which
  both `diff` and `turn` import (they must not import each other).
- Card code that walks the DOM (`j` / `k`, the seen observer) skips folded groups and folded
  stacks for free; code that works from data must check `isFolded`.
- Expanded cards: module signals in `state/prDetail.ts` (`expandedIds`, `details`, `detailOf`);
  `loadDetail` sits in `state/loadDetail.ts` so the query ships with the details chunk. A detail
  answer must match both its loading entry and the auth it started with.
- Stacks: `listItems` / `stackMembers` (open members only) / `stackState` / `stackSummary` (ready
  run from `stack.bottom`) in `src/lib/stacks.ts`; `StackItem` loads lazily, so tests wait for it
  with `findBy…`. `StackMergeButton` / `StackMergeDialog` serve the stack and a stacked card's
  "Merge up to here"; the dialog needs the top's detail (unit tests seed `details`).
- Review threads load on demand through `state/reviewThreads.ts` (keyed by `updatedAt`, paged,
  `complete: false` past 5 pages); written review drafts survive folding in `state/reviewDrafts.ts`.
- State one account read resets through `onAccountChange(reset)` (`state/store.ts`); loaders
  publish only while `auth.value` is their session and their entry is still the request they put.

## Actions

- Run every GitHub write from the panel with `runPrAction(pr, name, done, run, onError?)`
  (`state/prActions.ts`): one action per PR, toast, then a `change` poll. E2E asserts on
  `github.requestsFor('ProwlApprove')[0].body.variables`.
- `MergeAction` renders nothing until `detailOf(pr)` has the detail (only it says whether a merge
  queue applies); what it may offer is `mergeOptions` and the method `pickMethod`
  (`components/mergeReadiness.ts`, shared with `MergeQueueAction` and the stack merge). A stacked
  PR gets only `StackRoute`. Unit tests use `show()` from `MergeAction.test-support.tsx`.
- To make a merged PR leave the list in E2E, drop it from the `ProwlSearch` answer and answer
  `ProwlNodes` with `closedNode(id)`.
- Shortcuts: one case in `shortcutFor` (`state/shortcuts.ts`), one row in `SHORTCUTS` and its
  action in `useShortcuts` (`components/Shortcuts.tsx`); character keys go in `CHARACTER_KEYS`.
  Approve and Merge have no key on purpose.

## On-device AI

- `src/lib/ai/builtInAi.ts` wraps Chrome's `Summarizer` / `LanguageModel` / `Translator` (tests set
  fakes on `globalThis`); panel state is `state/localAi.ts`. Output is untrusted text, and inputs
  go through `fitInput` (`src/lib/ai/fitInput.ts`), which fits them to the model's measured quota.
- `modelFor(task, models)` is the only model choice (display, download, run); `startTask` must be
  called before the first await of a click so a download keeps the user activation.

## Localization

- `t(key)` from `src/lib/i18n.ts`; add every message to all seven catalogs in
  `public/_locales/`, and remove unused ones (`i18n.test.ts` fails on them). Use whole sentences
  with `$P1$` placeholders, `countMessage` for plurals, `formatNumber` and `uiLocale()`.
  `Message` renders markup slots as children, never HTML.
- Show stored sections through `sectionLabel`; never translate ids, queries or repository names.
  Keep worker translations inside functions so a language change applies without a restart.

## Manifest and permissions

- What the manifest may ask for is locked in `tests/fixtures/manifestLock.ts` (`ALLOWED_KEYS`,
  permission lists). A new permission also needs `docs/privacy.md`, README,
  `docs/chrome-web-store.md`, the landing page (`tests/unit/siteAccess.test.ts`) and a row in
  `NAMED_PERMISSIONS` (`views/SettingsModel.ts`).
- `permissions.spec.ts` is the only spec on the production `dist/`. Source code may only call
  `chrome.tabs.create`.

## Screenshots and site

- Only `pnpm screenshots` writes `docs/screenshots/` (2x, through `saveScreenshot`);
  `PROWL_SCREENSHOT_NAMES=a,b` limits it. `tests/unit/images.test.ts` fails on a 1x file. Show them
  at 400 x 760 CSS px; `pnpm store-images` derives the store images.
- Site pages (`site/src/pages`) render `docs/auth.md`, `docs/privacy.md`, `CHANGELOG.md` and
  `CONTRIBUTING.md`: edit the Markdown. Link Markdown files with absolute URLs, images with
  `./screenshots/<name>.png`; hand-written pages use `site/src/components/Screenshot.astro`.
- Keep `compressHTML` off in `site/astro.config.mjs` (it dropped spaces before inline tags).
  `pnpm --filter site lighthouse` must stay at 95 or more everywhere.

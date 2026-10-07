# E2E coverage of the spec

Every row of the brief's Decisions table, mapped to Playwright tests that run against the real
extension (`dist-e2e/` loaded in Chromium) and the mock GitHub (`tests/e2e/mock-github`).
Pure logic behind each row is also unit-tested (`src/**/*.test.ts`).

| Spec item | E2E test(s) |
|---|---|
| **Surface**: MV3, native side panel | `smoke` loads the extension, checks MV3 and `side_panel`; `shell` |
| **Scope**: authored by default | `poller` (default query), `list` › sections as tabs |
| Scope presets: review requested, mentioned, assigned, custom search | `scope` (every preset and a custom query reach `ProwlSearch`), `settings` › scope |
| Repo include / exclude | `scope` (`user:`/`-repo:` qualifiers and client-side exclusion), `settings` › include and exclude lists |
| **PR state**: CI rollup, review decision, mergeable/conflicts, draft, labels, last activity, age, unresolved comments | `list` › a card says everything about its pull request, label text is readable; `detail` › why it is blocked |
| **Notifications**: CI failed | `notifications` › CI going from pending to failed notifies once per commit |
| CI passed after failure, new review, approved, changes requested, new comment, ready to merge, merged/closed by someone else | `notifications` › every kind of change by someone else notifies with its own event |
| Per-event toggles, quiet hours | `notifications` › switched-off events and quiet hours; `settings` › the switches, quiet hours can cross midnight |
| Muted / snoozed PRs silent | `notifications` › a muted pull request produces no notification; `local-actions` |
| More than three events → one summary | `notifications` › more than three events in one poll become one summary |
| Action-icon badge | `badge` (attention count, red on failure, follows snooze/seen/mode, cleared by sign-out); `local-actions` |
| **Updates**: `chrome.alarms`, default 2 min, min 1 | `poller` › schedules the next; `settings` › reschedules polling when the interval changes |
| Rate-limit aware | `poller` › waits for the rate limit to reset, even for a forced poll; `errors` › rate limited |
| Backoff on errors | `errors` › offline: banner counts down to the retry; a GitHub error |
| **Actions**: approve | `review` › approves in one click |
| Request changes (confirm dialog) | `review` › requests changes only with a message, in a dialog |
| Comment | `review` › comments on your own pull request |
| Merge, method picker limited to repo, confirm | `merge` (methods, default, confirm, cancel/Escape, refusal, no button without write access) |
| Re-run failed checks | `maintenance` › re-runs failed Actions jobs and other failed check suites |
| Ready for review / convert to draft | `maintenance` › marks a draft ready and converts a ready PR to draft |
| Snooze (local), mute (local) | `local-actions` › snoozes out of the list and the badge, and back; mutes |
| Open in GitHub, copy branch name | `local-actions` › mutes, copies its branch and opens it on GitHub; `list` › opens the PR |
| **Auth**: OAuth device flow | `device-flow` (approve, denied, device flow disabled, cancel) |
| PAT, classic or fine-grained | `auth` › classic, no-repo-scope warning, fine-grained warning, invalid token, sign-out |
| **Backend**: none, GitHub only | All E2E runs offline against the mock; `review` › never the token in errors; `performance` › no network on open |
| Errors, offline, revoked token | `errors` (401, 403 rate limit, 502, refused connection, stale data) |
| Keyboard and accessibility | `keyboard` (shortcuts, axe light/dark on list, expanded card, settings, shortcuts dialog); axe in every spec |
| Performance budget | `performance` › first list render ≤ 150 ms from cache |
| Sharp docs screenshots | `pnpm screenshots` saves every `saveScreenshot` at 2x (800 px wide); `tests/unit/images.test.ts` checks the committed sizes |

Flake check for v1.0.0: the full suite (93 tests) ran three times in a row, 93/93 each time (see
`progress.txt`, US-027).

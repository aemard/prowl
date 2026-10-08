# Threat model

Prowl is a Manifest V3 extension that holds a GitHub token able to read private repositories,
approve, merge and re-run CI. That token is the asset worth protecting. Method: STRIDE over the
data flows below. Last reviewed: 2026-10-06, for the v1.0.0 release; the site-access lock below was
added on 2026-10-07 (US-032).

## Assets

| Asset | Where | Impact if lost |
|---|---|---|
| GitHub token (`repo` scope or fine-grained) | `chrome.storage.local` → `auth` | Read private code, approve/merge as the user, re-run CI |
| PR snapshot (titles, branches, labels, CI and review state) | `chrome.storage.local` → `snapshot` | Disclosure of private repository metadata |
| Settings, snoozes, mutes, seen markers | `chrome.storage.local` | Low (preferences) |
| Notified event ids and their PR URLs | `chrome.storage.session` | Low (names private repos and PR numbers; cleared when Chrome closes or on sign-out) |

## Trust boundaries and data flows

```
 user ──paste token / approve device code──▶ side panel (extension origin)
 side panel ◀──chrome.storage──▶ service worker            (same extension, trusted)
 service worker / side panel ──HTTPS + Bearer token──▶ api.github.com
 side panel ──device flow (client id, device code)──▶ github.com   (optional permission)
 api.github.com ──untrusted JSON (titles, labels, names, URLs)──▶ Prowl
 Prowl ──chrome.tabs.create(url)──▶ browser tab (github.com only)
 Prowl ──chrome.notifications──▶ OS notification centre (PR title, repo, actor)
 img-src: avatars.githubusercontent.com only (avatar URLs come from GitHub and are constrained by CSP)
```

Untrusted input: everything GitHub returns that a third party can author (PR titles, branch and
label names, label colors, comment authors, check names and URLs, error messages), plus anything
another extension or web page could send.

## Threats and mitigations

| STRIDE | Threat | Mitigation | Where |
|---|---|---|---|
| S | A web page or another extension sends Prowl messages to trigger polls or sign-out | No `externally_connectable`, no `onMessageExternal`; `onMessage` drops any sender whose `id` is not Prowl's | `src/background/messages.ts`, manifest test |
| S | A phishing page imitates the device-flow screen | Device flow only talks to `env.webUrl` (`github.com`); the user enters the code on github.com itself | `src/lib/github/auth/deviceFlow.ts` |
| T | Script injection through PR titles, labels, branch names | Preact renders text only; `dangerouslySetInnerHTML` is a lint error; no `innerHTML`, `eval` or `new Function` anywhere | Biome `security/noDangerouslySetInnerHtml` |
| T | Malicious label color breaks out of a style attribute | Colors validated as 6 hex digits by the mapper, fallback neutral | `src/lib/github/mapPullRequest.ts` |
| T | A push lands just before Approve, so unseen code gets approved or merged | Reviews pass `commitOID` and merges `expectedHeadOid` = the head the panel showed | `src/lib/github/actions.ts` |
| T | A branch name with shell syntax runs code when pasted into a terminal | "Copy branch name" warns when the name holds characters outside `[\w./+@-]` or bidi controls | `PrMenu.tsx` |
| I | A snapshot from a previous account shows its private PRs to the next one | The list ignores a snapshot whose viewer is not the signed-in account; sign-in clears a foreign snapshot | `List.tsx`, `session.ts` |
| T | Remote code loaded into extension pages | CSP `script-src 'self'; object-src 'none'; base-uri 'none'`; MV3 forbids remote code; no CDN assets | `src/manifest.ts` |
| R | Actions taken without the user's intent | Merge and request changes need a confirmation dialog; every action is a user click; GitHub's audit log records them as the user | `src/sidepanel/components/*Actions*` |
| I | Token leaks into logs, errors, UI or notifications | Client masks the token in every message it builds or relays (tested on message, stack, JSON, inspect); the token is never rendered; sign-in errors never echo input | `src/lib/github/client.ts`, `errors.ts`, `pat.ts` |
| I | Token sent to a non-GitHub host | The only Bearer requests go to `env.apiUrl`; CSP `connect-src` allows only `api.github.com` and `github.com`; host permission only `api.github.com` | `client.ts`, manifest |
| I | Token synced to other devices or read by web pages | Stored in `storage.local` (never `sync`); no content scripts, no `web_accessible_resources` | `src/lib/storage`, manifest test |
| I | Opening attacker URLs from data (check links, PR URLs) | `isGitHubUrl` allowlists the GitHub web origin for every tab, link and notification click; third-party CI links render as plain text | `src/lib/url.ts`, `GitHubLink.tsx`, `notifier.ts` |
| I | Notifications reveal private PR titles on a shared screen | Quiet hours and per-event toggles; OS notification privacy settings apply | `src/lib/notify` |
| D | Polling exhausts the user's API budget | Minimum interval 2 min, rate-limit aware waits, low-budget pause, exponential backoff with jitter, single-flight polls | `src/background/poller.ts`, `src/lib/time/backoff.ts` |
| D | A huge or hostile response stalls the panel | Results capped per section (≤ 100), error messages truncated, 20 s request timeout | `fetchPullRequests.ts`, `client.ts` |
| E | Over-broad permissions widen the blast radius | The manifest is held to an exact list by the site-access lock: permissions `sidePanel`, `storage`, `alarms`, `notifications`; host `api.github.com`; optional host `github.com`, requested when the device flow starts and removed when it ends and on sign-out. Any other permission, host or top-level manifest key fails the build, and the same lock runs on the built extensions loaded in Chrome | `tests/fixtures/manifestLock.ts`, `tests/unit/siteAccess.test.ts`, `tests/e2e/permissions.spec.ts`, `session.ts` |
| I | The extension (or code that reaches it) spies on the pages the user visits | Chrome has nothing to give it: no content scripts, no `scripting`, `activeTab`, `tabs`, `history`, `webNavigation`, `webRequest`, `declarativeNetRequest` or `cookies`, no host beyond GitHub; the code only ever calls `chrome.tabs.create`. The panel shows Chrome's live permission list, and docs/privacy.md has the table of what each permission allows and what the install prompt shows | lock above, `tests/unit/siteAccess.test.ts` (source scan, docs name every permission), Settings › Privacy and permissions |
| T | Settings synced by another device (or a tampered Chrome sync copy) inject bad values | Sync is off unless the user turns it on, per device; incoming copies go through `normalizeSettings` like any stored value (custom queries are still validated before use, team keys and repo patterns are checked), and only the `settings` key is ever written to `chrome.storage.sync` | `src/background/sync.ts`, `sync.test.ts` |
| I | GitHub cookies ride along with Prowl's requests | Every request to api.github.com and github.com sets `credentials: 'omit'`: the token authenticates, and the optional github.com permission would otherwise attach the user's session cookies to the device flow | `client.ts`, `deviceFlow.ts` |
| T | A team slug turns into a search qualifier | Discovered teams are kept only when `org/slug` matches the same rule as `unfollowedTeams` (`TEAM_KEY`) before it reaches `team-review-requested:` | `teams.ts`, `settings.ts` |
| E | Supply-chain compromise of a dependency or action | Two direct runtime dependencies (Preact, @preact/signals, which pulls @preact/signals-core); the release job builds without a shared dependency cache; lockfile; Dependabot; CodeQL; dependency review; Scorecard; actions pinned to commit SHAs with least-privilege `permissions` and `persist-credentials: false`; releases ship an SBOM and provenance | `.github/workflows` |

## Residual risks (accepted)

- **Local attacker or malware with access to the browser profile** can read the token from
  extension storage. Encrypting it with a key stored next to it would not help; use a
  fine-grained token limited to a few repositories, or revoke the token, to bound the risk.
- **The `repo` scope is broad** for classic tokens and the OAuth App (GitHub offers nothing
  narrower that still reads private PRs and CI). Fine-grained tokens narrow it but lose CI status
  (no Checks permission for tokens).
- **Malicious extension with broad privileges** installed in the same profile is out of scope:
  Chrome isolates extension storage, but such an extension could still attack github.com tabs.
- **GitHub itself** is trusted for the data it returns and for TLS.
- **A GitHub host permission still lets an extension read the address and title of the tabs on
  that host** (`chrome.tabs`, Chrome's rule for any host permission). For Prowl that is a tab
  showing api.github.com, or github.com while the device flow runs. The code never queries tabs
  (a test fails if it does), and docs/privacy.md says so in "The one thing a site permission
  still shows". A malicious update could still add such a call: the lock keeps the manifest
  honest, not the code, so release provenance and review of the diff remain the control.
- **Side-loaded installs** ("Load unpacked") do not auto-update; users must watch releases.
  Release zips carry a provenance attestation so users can verify their origin.

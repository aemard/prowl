# Threat model

Prowl is a Manifest V3 extension that holds a GitHub token able to read private repositories,
approve, merge and re-run CI. That token is the asset worth protecting. Method: STRIDE over the
data flows below. Last reviewed: 2026-10-06, for the v1.0.0 release; the site-access lock below was
added on 2026-10-07 (US-032); Trusted Types, the site's CSP and token expiry on 2026-10-30
(review.md); the assurance case on 2026-10-30.

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
| T | Script injection through PR titles, labels, branch names | Preact renders text only; `dangerouslySetInnerHTML` is a lint error; no `innerHTML`, `eval` or `new Function` anywhere; the CSP enforces Trusted Types (`require-trusted-types-for 'script'; trusted-types 'none'`), so Chrome itself refuses a string in an HTML or script sink (E2E checks it) | Biome `security/noDangerouslySetInnerHtml`, `src/manifest.ts`, `tests/e2e/smoke.spec.ts` |
| T | Malicious label color breaks out of a style attribute | Colors validated as 6 hex digits by the mapper, fallback neutral | `src/lib/github/mapPullRequest.ts` |
| T | A push lands just before Approve, so unseen code gets approved or merged | Reviews pass `commitOID` and merges `expectedHeadOid` = the head the panel showed | `src/lib/github/actions.ts` |
| T | A branch name with shell syntax runs code when pasted into a terminal | "Copy branch name" warns when the name holds characters outside `[\w./+@-]` or bidi controls | `PrMenu.tsx` |
| I | A snapshot from a previous account shows its private PRs to the next one | The list ignores a snapshot whose viewer is not the signed-in account; sign-in clears a foreign snapshot | `List.tsx`, `session.ts` |
| T | Remote code loaded into extension pages | CSP `script-src 'self'; object-src 'none'; base-uri 'none'` plus Trusted Types; MV3 forbids remote code; no CDN assets | `src/manifest.ts` |
| T | Raw HTML in a Markdown page of the website (changelog, guides) runs script or loads from elsewhere | The site ships no JS; every page carries a CSP with `script-src 'none'`, `default-src 'none'` and only same-origin images and connections | `site/src/layouts/Base.astro` |
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
| T | A release built from code that skipped review reaches users | `main` needs a pull request with `Verify` and CodeQL and signed commits; `v*` tags cannot move or be deleted and `release-tag.yml` refuses a tag that is not on `main`; releases are immutable once published; a maintainer approves each store submission, and the job only uploads the release's zip after `gh attestation verify` ties it to `release-assets.yml`; anyone can rebuild a tag and get the same bytes (docs/releasing.md) | `.github/workflows`, repository rulesets, `scripts/zip.mjs` |

## Assurance case

The claim: a third party cannot read or use the user's token, run code in the extension, or act
on GitHub in the user's name. The argument rests on the threat model above (assets, data flows,
the STRIDE table), its trust boundaries (anything GitHub returns that a third party can write is
untrusted), the design principles and the weaknesses countered below. The evidence is the tests
and files in the "Where" column, CodeQL on every pull request, Scorecard, and the reviews in
[review.md](review.md).

| Design principle (Saltzer and Schroeder) | How Prowl applies it |
|---|---|
| Economy of mechanism | Two direct runtime dependencies, no backend, one remote host |
| Fail-safe defaults | URLs, label colors, team keys and settings are rejected or reset to a default unless they match an allowlist; `github.com` access is off unless the device flow runs |
| Complete mediation | Every opened URL goes through `isGitHubUrl`, every message through the sender check, every stored or synced setting through `normalizeSettings` |
| Open design | Open source with this threat model; nothing relies on a secret other than the user's token |
| Separation of privilege | A store release needs a tag on `main`, an attestation that `gh attestation verify` accepts, and a person's approval |
| Least privilege | Four permissions and one host (manifest lock); fine-grained tokens supported; workflows default to read-only `permissions` |
| Least common mechanism | No shared server: each user's data stays in their own browser profile |
| Psychological acceptability | Sign-in is one click or one paste; Settings lists the live permissions; only merge and request changes ask for confirmation |

| Common weakness | Countered by |
|---|---|
| CWE-79 cross-site scripting | Text-only rendering, the lint rule, Trusted Types |
| CWE-94, CWE-829 code injection, remote code | CSP `script-src 'self'`, MV3, no CDN assets |
| CWE-601 open redirect | `isGitHubUrl` on every tab, link and notification click |
| CWE-200, CWE-532 token exposure | Token masked in every error, never rendered, never sent outside `env.apiUrl` |
| CWE-346 origin validation | `onMessage` drops senders other than Prowl |
| CWE-20 input validation | Mappers allowlist label colors, `validatePat` the token characters, `TEAM_KEY` the team slugs |
| CWE-367 time-of-check to time-of-use | Approve and merge pin the head commit the panel showed |
| CWE-400 resource exhaustion | Result caps, request timeout, backoff, rate-limit awareness |
| CWE-78 command injection in CI | Workflow inputs reach shells only through `env:` |
| CWE-1357 untrusted components | Lockfile, pinned actions, Dependabot, dependency review, SBOM and provenance |

## Residual risks (accepted)

- **Local attacker or malware with access to the browser profile** can read the token from
  extension storage. Encrypting it with a key stored next to it would not help; use a
  fine-grained token limited to a few repositories, or revoke the token, to bound the risk.
- **Tokens from Continue with GitHub never expire** (OAuth Apps), and a classic token may be
  created without an expiry. Prowl shows the expiry GitHub reports (Settings, Account) and warns a
  week before a token stops working, which encourages tokens that expire; revoking one stays the
  user's call (auth.md).
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

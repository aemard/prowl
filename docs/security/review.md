# Security review

## 2026-10-06 — US-023 hardening pass (author review)

Scope: manifest, CSP, permissions, token handling, rendering of untrusted data, URL handling,
storage, messaging, dependencies, workflows. Method: code audit against
[threat-model.md](threat-model.md), plus `pnpm audit --prod`.

| # | Area | Finding | Severity | Status |
|---|---|---|---|---|
| 1 | Dependencies | `pnpm audit --prod`: no known vulnerabilities; 2 runtime deps (preact, @preact/signals) | — | OK |
| 2 | Rendering | No `innerHTML`, `dangerouslySetInnerHTML`, `eval` or `new Function` in `src/`; Biome rule enforces it | — | OK |
| 3 | URLs | Every `chrome.tabs.create` and every rendered link goes through `isGitHubUrl` (origin equality with `env.webUrl`); third-party CI links render as text | — | OK |
| 4 | Token | Masked in all client errors (tests cover message, stack, JSON, inspect); never rendered; `validatePat` rejects characters outside `[A-Za-z0-9_]` before it reaches a header | — | OK |
| 5 | Messaging | `onMessage` drops senders other than Prowl; no `onMessageExternal`, no `externally_connectable` | — | OK |
| 6 | Manifest | No content scripts or web-accessible resources; CSP without `unsafe-*`; `github.com` optional. Regression test added (`src/manifest.test.ts`) | — | Fixed (test) |
| 7 | Logging | Worker logs errors with `console.error`; `GitHubError` carries the masked message only | Low | OK |
| 8 | Workflows | Least-privilege `permissions`, SHA-pinned actions, `persist-credentials: false`, no `pull_request_target`, workflow inputs reach shells only through `env:` | — | OK |
| 9 | Storage | Token in `storage.local` unencrypted | Low | Accepted, documented as residual risk |

Verdict for this pass: no critical or high findings. The independent release review (US-028)
follows below.

## 2026-10-06 — US-028 independent release review

Reviewer: a separate agent that did not write the code (`.claude/agents/security-reviewer.md`),
read-only, at `28b23a5`. Scope: all of `src/`, the manifest, every workflow, dependencies, and the
threat model's claims.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| F1 | Low | Approve/request changes did not pin the head commit: a push just before the click got approved unseen | Fixed: `commitOID` = `pr.headSha` (`actions.ts`), tested |
| F2 | Low | Release job restored the shared pnpm cache before building the attested zip | Fixed: no dependency cache in `release-assets.yml` |
| F3 | Low | Optional `github.com` permission kept forever after the device flow | Fixed: removed when the flow ends and on sign-out |
| F4 | Low | "Copy branch name" copies attacker-chosen names with shell syntax or bidi controls | Fixed: warning toast for such names, tested |
| F5 | Info | A sign-out racing a poll could leave another account's snapshot visible after the next sign-in | Fixed: list ignores a snapshot of another viewer; sign-in clears it |
| F6 | Info | `img-src https://*.githubusercontent.com` broader than needed | Fixed: `avatars.githubusercontent.com` only |
| F7 | Info | Attestation check accepted any workflow; anyone with push access can tag a release | README uses `--signer-workflow`; protect `v*` tags with a ruleset (maintainer setting, see docs/releasing.md) |

Threat-model claims checked: sender checks, device-flow origin, no HTML sinks, label colors, CSP,
confirmations, token masking and destination, storage areas, URL allowlist, polling limits,
permissions and supply-chain controls were verified. Corrected in the threat model: notified
event ids also store PR URLs; three runtime packages ship (two direct); the optional permission
is now given back; avatar URLs are constrained by CSP, not by the mapper.

**Verdict: APPROVE** (no critical or high findings; all low findings fixed before v1.0.0).

## 2026-10-07 — US-043 review of the v1.2 changes

Scope: everything since v1.1.0 (`git diff 9218e05..HEAD`): the `read:org` scope and stored teams,
the team search, `chrome.storage.sync`, notification buttons, the `commands` key, the
update-branch and auto-merge mutations, the permission lock and privacy panel, the Dependabot
auto-merge workflow and the toolchain bump. Method: code audit against
[threat-model.md](threat-model.md), `pnpm audit --prod`, the GraphQL documents validated against
GitHub's public schema.

| # | Severity | Finding | Status |
|---|---|---|---|
| F1 | Low | Requests did not set `credentials`: with the optional github.com permission granted, the device flow's POSTs carried the user's GitHub session cookies | Fixed: `credentials: 'omit'` in `client.ts` and `deviceFlow.ts`, tested |
| F2 | Low | Discovered team `org/slug` reached the search query unvalidated (settings validated only the unfollowed list) | Fixed: `toTeam` keeps only keys matching `TEAM_KEY`, tested with a slug carrying a qualifier |
| F3 | Info | Synced settings are untrusted input | OK: `normalizeSettings` on every pull, opt-in per device, only `settings` written (test lists the sync area) |
| F4 | Info | Update branch, enable auto-merge and merge could act on a head the user did not see | OK: each mutation passes the polled head as `expectedHeadOid` |
| F5 | Info | Notification "Snooze 1 h" derives the PR from the notification id | OK: only for ids Prowl recorded in `notified` (session storage) |
| F6 | Info | `commands` manifest key | OK: no permission or install warning; the lock allows only this key and privacy.md says so |
| F7 | Info | Dependabot auto-merge | OK: `pull_request` (not `_target`), Dependabot-only, SHA-pinned `fetch-metadata` (which also checks every commit is Dependabot's), dev and Actions patch/minor only. It relies on the `Verify` check being required on `main` (maintainer setting, docs/releasing.md) |
| F8 | Info | `read:org` widens what a token can read | Accepted: listing teams needs it; tokens without it keep working and Team reviews says why |

`pnpm audit --prod`: no known vulnerabilities.

**Verdict: APPROVE**, once `Verify` is a required check on `main` (F7).

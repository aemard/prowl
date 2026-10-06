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

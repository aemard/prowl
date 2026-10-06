# Prowl

**Your GitHub pull requests, at a glance, in Chrome's side panel.**

Prowl shows the live state of the pull requests you care about (CI, reviews, conflicts, draft,
labels, activity), notifies you when something changes, and lets you act (approve, request
changes, comment, merge, re-run failed checks, toggle draft) without leaving the tab you are on.

100% client-side: no backend, no telemetry, no third-party servers. Your token stays in your
browser and is only ever sent to GitHub.

<p align="center">
  <img src="docs/screenshots/list-light.png" alt="Prowl's side panel listing pull requests with CI, review and merge status" width="380">
</p>

[Website](https://aemard.github.io/prowl/) ·
[Install guide](https://aemard.github.io/prowl/install/) ·
[Sign-in guide](https://aemard.github.io/prowl/auth/) ·
[Privacy](https://aemard.github.io/prowl/privacy/) ·
[Changelog](CHANGELOG.md)

## Install (about 2 minutes)

1. Download `prowl-vX.Y.Z.zip` from the [latest release](https://github.com/aemard/prowl/releases/latest) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.
4. Pin Prowl from the puzzle-piece menu, then click its icon to open the side panel.
5. Sign in: **Continue with GitHub**, or paste a token (see below).

Requires Chrome 116 or later. Each release also ships an SBOM and a build provenance
attestation (`gh attestation verify prowl-vX.Y.Z.zip --repo aemard/prowl`).

## Sign in

| Way | What you need | CI status |
|---|---|---|
| Continue with GitHub | One click (device flow; available when the build has an OAuth client id) | Yes |
| Classic token | [Create one with the `repo` scope](https://github.com/settings/tokens/new?scopes=repo&description=Prowl) | Yes |
| Fine-grained token | Pull requests, Contents, Actions (read and write), Commit statuses and Metadata (read) | Can be missing |

Fine-grained tokens cannot read check runs (GitHub only grants the Checks permission to Apps), so
CI status may be missing with them. Details: [sign-in guide](docs/auth.md).

## Features

- **Scope**: PRs you authored by default; add review requested, mentioned, assigned, custom
  GitHub searches, and repository include/exclude filters. Each scope is a tab.
- **State on every card**: CI rollup, review decision, mergeable or conflicts, draft, labels,
  unresolved threads, comments, last activity and age. Expand a card for failing checks,
  reviewers and what blocks the merge.
- **Notifications**: CI failed, CI passed after a failure, new review, approved, changes
  requested, new comment, ready to merge, merged or closed by someone else. Per-event toggles,
  quiet hours, and a toolbar badge counting PRs that need you.
- **Actions**: approve, request changes and merge (with confirmation; only the merge methods the
  repository allows), comment, re-run failed checks, ready for review / convert to draft,
  snooze, mute, open in GitHub, copy branch name.
- **Polite polling**: every 2 minutes by default (1 minute minimum), rate-limit aware, with
  backoff on errors. Light and dark themes, full keyboard support.

## Privacy

Prowl only talks to `api.github.com` (and `github.com` for the optional device-flow sign-in).
Settings, the token and the PR snapshot live in `chrome.storage.local`; snoozes and mutes never
leave your machine. See the [privacy policy](docs/privacy.md).

## Development

```sh
pnpm install
pnpm verify        # Biome, types, unit tests + coverage gates, build, site, size budget, E2E
pnpm build         # production build in dist/ (load it unpacked)
pnpm dev           # rebuild dist/ on change
pnpm e2e           # Playwright against the real extension and a mock GitHub
pnpm screenshots   # same, and refresh docs/screenshots/
pnpm zip           # prowl-v<version>.zip from dist/
```

Node 22+ and pnpm 10. E2E tests never touch the real GitHub: they load `dist-e2e/` into Chromium
and point it at a local mock server (`tests/e2e/mock-github`).

| Path | What |
|---|---|
| `src/background/` | Service worker: polling, notifications, badge |
| `src/sidepanel/` | Preact UI (views, components, design system in `components/ui/`) |
| `src/lib/` | Pure logic: GitHub client and queries, diff engine, storage, time |
| `site/` | Astro website deployed to GitHub Pages |
| `docs/` | Architecture, decisions, design, security, auth, releasing |

Start with [`docs/architecture.md`](docs/architecture.md) and
[`CONTRIBUTING.md`](CONTRIBUTING.md). Security issues: see [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE)

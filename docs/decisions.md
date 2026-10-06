# Decisions and assumptions

One line each, with the reason. Product decisions from the brief are not repeated here.

- 2026-10-06 — Sections 3–13 of the brief were collapsed and unreadable to the orchestrator; conventions they may have defined (stack, design, agents, phases) were reconstructed from the visible sections and are recorded below.
- 2026-10-06 — Name "Prowl" kept: the only Chrome extension with that name (afjmhofmjbffpakdiiilmkcdclabhmmb, last updated 2012) was removed from the Chrome Web Store on 2023-08-12; caarlos0/prowl is a terminal tool, not an extension.
- 2026-10-06 — Ralph runs as one fresh-context subagent per iteration driven by the orchestrator, because nested `claude --dangerously-skip-permissions` sessions are blocked in this sandbox; `scripts/ralph/ralph.sh` is still provided for local runs.
- 2026-10-06 — Commits are authored by the maintainer and committed/signed by Claude so GitHub shows them as verified.
- 2026-10-06 — Preact 10.29 + @preact/signals instead of React: ~4 KB runtime keeps the side panel inside its JS budget; Preact 11.0.0 shipped 6 days ago, too fresh for the ecosystem.
- 2026-10-06 — TypeScript 6.0 instead of 7.0: 7.x drops the JS compiler API some tools (Astro check) still rely on.
- 2026-10-06 — Plain Vite 8 multi-entry build with a generated manifest instead of CRXJS/WXT: fewer dependencies (supply chain) and full control of the MV3 output.
- 2026-10-06 — Playwright pinned to 1.56.1 so local runs use the sandbox's Chromium 141 build and CI installs the same revision.
- 2026-10-06 — Vitest + happy-dom with an in-repo `chrome.*` fake instead of sinon-chrome: typed, maintained here, no stale dependency.
- 2026-10-06 — E2E uses a local mock GitHub (127.0.0.1:4010) and a dedicated `e2e` build mode; tests are deterministic and never need a real token.
- 2026-10-06 — MIT license: permissive, standard for developer tools.
- 2026-10-06 — Minimum Chrome 116: `chrome.sidePanel.open` and the side panel API are stable from there.
- 2026-10-06 — English only in v1; strings are kept in components (i18n later).
- 2026-10-06 — github.com only in v1 (no GitHub Enterprise Server): keeps host permissions minimal.
- 2026-10-06 — Polling and notifications run in the service worker; user actions run from the side panel (immediate feedback) and then request a forced poll.
- 2026-10-06 — The OAuth App client id is injected at build time from the `PROWL_GITHUB_CLIENT_ID` repository variable; builds without it hide device flow and explain PAT sign-in, because an OAuth App can only be registered by the maintainer.
- 2026-10-06 — `github.com` is an optional host permission requested only when device flow starts; PAT users never grant it.
- 2026-10-06 — The token is stored unencrypted in `chrome.storage.local` (never `sync`): encrypting with a key stored next to it adds no protection; the threat model documents this.
- 2026-10-06 — Perf budget: side panel JS ≤ 60 KB gzip, CSS ≤ 12 KB gzip, service worker ≤ 30 KB gzip, whole extension ≤ 400 KB gzip; first list render from cache ≤ 150 ms (E2E).
- 2026-10-06 — Badge default `attention` = PRs with failing CI, changes requested, conflicts or ready to merge; red when CI fails or changes are requested.
- 2026-10-06 — Releases: release-please with `release-as: 1.0.0`; a tag-triggered workflow is the fallback if Actions may not open PRs. Assets: zip, SPDX SBOM (syft), build provenance attestation.
- 2026-10-06 — Actions are pinned to commit SHAs (Scorecard "Pinned-Dependencies").
- 2026-10-06 — Preset sections are fixed (id = kind, fixed label, enable/disable only) and normalization re-adds missing ones: the settings screen only toggles presets, and stable ids keep `snapshot.sections` keys valid across versions.
- 2026-10-06 — `pollIntervalMinutes` is capped at 60 (the brief only sets the minimum): a larger value is almost certainly corrupt data, and polling less than hourly defeats the product.
- 2026-10-06 — Settings migrations are keyed by the version they upgrade from; unversioned data counts as version 1, and data from a newer version (downgrade) is normalized best-effort instead of being discarded.
- 2026-10-06 — prLocal operations are pure reducers (state first) applied through `updatePrLocal()`, rather than one storage call each, so the notifier and badge can use them on in-memory state and one write can combine several operations.
- 2026-10-06 — Read-modify-write updates hold a Web Lock (`navigator.locks`), which the side panel and the service worker share (verified in Chromium 141), so a snooze in the panel cannot be lost to a concurrent prune in the worker; an in-context queue is the fallback.

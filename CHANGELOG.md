# Changelog

## [1.1.0](https://github.com/aemard/prowl/compare/v1.0.0...v1.1.0) (2026-10-07)


### Features

* **design:** minimal design system with the mint cat logo ([c51fcef](https://github.com/aemard/prowl/commit/c51fcef8494d52ac13856d7a70f85a8ed3851d84))
* **design:** mint design system, store listing images and Chrome Web Store publishing ([f3c1adb](https://github.com/aemard/prowl/commit/f3c1adb809cfcb0597a857795bd5ef09e8fb79eb))

## [1.0.0](https://github.com/aemard/prowl/compare/v0.1.0...v1.0.0) (2026-10-06)


### Features

* **auth:** US-011 sign in with a personal access token ([65f90bd](https://github.com/aemard/prowl/commit/65f90bd56ca085ac006a4e34144b65f5a528231b))
* **auth:** US-012 sign in with GitHub OAuth device flow ([0d2d1d3](https://github.com/aemard/prowl/commit/0d2d1d37e289bfb7e22f8ff4067c9e32194d7141))
* **background:** US-007 background poller with alarms, backoff and rate-limit awareness ([e3508bc](https://github.com/aemard/prowl/commit/e3508bce21a015484ce67bd12863bc13175221a5))
* **background:** US-009 action icon badge ([4b638a8](https://github.com/aemard/prowl/commit/4b638a809d7ff6eea3e8ffdd9ed02282f27ee553))
* **diff:** US-006 diff engine for changes between polls ([187c359](https://github.com/aemard/prowl/commit/187c35993c7fc28f9cc64b10a210a98b5808da14))
* **github:** US-003 HTTP client with classified errors and rate limits ([0fb8144](https://github.com/aemard/prowl/commit/0fb81447d048fa5a68711b87525f708ff9b9d194))
* **github:** US-004 search query builder and repo filters ([6b357cb](https://github.com/aemard/prowl/commit/6b357cbbf5db95858812444b2cfe3f831bda047b))
* **github:** US-005 fetch pull requests with full state ([3893063](https://github.com/aemard/prowl/commit/3893063335f96e6ec2c9be892cb01aa239c16137))
* **notifications:** US-008 notifications with per-event toggles and quiet hours ([6cf8b29](https://github.com/aemard/prowl/commit/6cf8b29eade850a92bf6aa3ec7a734467ebc2b77))
* **security:** US-023 threat model, security review and US-026 repo docs ([9a399b2](https://github.com/aemard/prowl/commit/9a399b288100b332e0e894f644a28ed93b34ed56))
* **sidepanel:** US-010 side panel shell, store and routing ([817c9c1](https://github.com/aemard/prowl/commit/817c9c1911912f4d535fafca3248bc5ca0de713b))
* **sidepanel:** US-013 PR list and card ([1f7b153](https://github.com/aemard/prowl/commit/1f7b153ae92a1cde25a6861fc07a21ccd967d4af))
* **sidepanel:** US-014 PR details on expand ([a9074c8](https://github.com/aemard/prowl/commit/a9074c88c3525737af26c67475fcfe938c5a073f))
* **sidepanel:** US-015 review actions: approve, request changes, comment ([147156f](https://github.com/aemard/prowl/commit/147156f8c62c38bc482aa5423622d52eff13a71a))
* **sidepanel:** US-016 merge with a method picker and confirmation ([41514c8](https://github.com/aemard/prowl/commit/41514c8ed181e5786c057780ea67aa9705eda2c2))
* **sidepanel:** US-017 re-run failed checks and draft toggle, US-018 card menu with snooze and mute ([729bb82](https://github.com/aemard/prowl/commit/729bb82aa264a4efda7a1e42a5de1ad16ec34bc5))
* **sidepanel:** US-019 settings screen ([e175ff1](https://github.com/aemard/prowl/commit/e175ff137c39e04869d990a59c77293c8ee54c64))
* **sidepanel:** US-020 keyboard shortcuts, refresh announcements and a11y sweep ([390e9a2](https://github.com/aemard/prowl/commit/390e9a270e91c7438393cfed1c3b8028998a82c0))
* **sidepanel:** US-021 error, offline and rate-limit states ([4236f73](https://github.com/aemard/prowl/commit/4236f73a2713909bcb17d6038ce7494ac79e6461))
* **site:** US-024 Astro website with landing page and Pages deploy ([6c0c3e1](https://github.com/aemard/prowl/commit/6c0c3e119bd49c802dee47e9add736a42fcca0a1))
* **site:** US-025 guides, privacy, changelog, contributing and Lighthouse gate ([665f3b8](https://github.com/aemard/prowl/commit/665f3b8552050a49f9924e93e6846ebb3d69ab53))
* **storage:** US-002 typed storage, settings normalization and local PR state ([6fa51c8](https://github.com/aemard/prowl/commit/6fa51c89bb23ca024830b6b19d4046fd461bb7c6))
* **ui:** US-001 design language, brand and base UI components ([e808cf9](https://github.com/aemard/prowl/commit/e808cf93482d80623bc56b1715bfad20206437ca))


### Bug Fixes

* **e2e:** US-029 settle color transitions before axe scans, keep quick repo edits ([8c7dbaa](https://github.com/aemard/prowl/commit/8c7dbaac353340bf8deebcc7e9e84cb6496764bd))
* **sidepanel:** import isGitHubUrl from src/lib/url after merging US-013 ([df15b1e](https://github.com/aemard/prowl/commit/df15b1e9c74fd6611ba78e4d89616d417229def9))
* US-028 security review fixes and CI-only E2E failures ([fd01910](https://github.com/aemard/prowl/commit/fd01910a70ca9d1609c43041daf1dc4a8fb4c907))


### Performance Improvements

* **sidepanel:** US-022 lazy-load settings and details, first-render budget ([28b23a5](https://github.com/aemard/prowl/commit/28b23a50eefa4997013f2457d87c05dfd3ac86b4))

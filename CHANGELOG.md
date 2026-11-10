# Changelog

## [1.5.0](https://github.com/aemard/prowl/compare/v1.4.0...v1.5.0) (2026-11-09)


### Features

* clarify list visibility and restore reading context ([#50](https://github.com/aemard/prowl/issues/50)) ([2e33ad2](https://github.com/aemard/prowl/commit/2e33ad2173b5c588c24987ed7617a57bd13c7bb9))
* **i18n:** add Japanese, Chinese, French, German and Spanish support ([#55](https://github.com/aemard/prowl/issues/55)) ([6a3eaed](https://github.com/aemard/prowl/commit/6a3eaede6cc0116fa946f6073ab475573ec3e389))
* **onboarding:** go straight to the list after sign-in, with a first-run note ([#71](https://github.com/aemard/prowl/issues/71)) ([f8a87b6](https://github.com/aemard/prowl/commit/f8a87b60438bed461b97cc29bb7e5790e7025266))
* **settings:** six clear groups and team choice inside Team reviews ([#69](https://github.com/aemard/prowl/issues/69)) ([3243dc7](https://github.com/aemard/prowl/commit/3243dc71bbbcf774b28d0c776edc0c4a04705a6a))
* **ui:** animate pull request cards in and out ([#63](https://github.com/aemard/prowl/issues/63)) ([0d73c88](https://github.com/aemard/prowl/commit/0d73c883943545a8cdd394c72a1cc26bfc96c0d8))
* **ui:** simplify the expanded card, team reviews and settings ([#74](https://github.com/aemard/prowl/issues/74)) ([e33636e](https://github.com/aemard/prowl/commit/e33636e972482f2230487537caf4c1b65ea1688f))


### Bug Fixes

* **actions:** re-run failed checks one at a time and explain status-only failures ([#73](https://github.com/aemard/prowl/issues/73)) ([4dd0e90](https://github.com/aemard/prowl/commit/4dd0e9076270ecd2285b4e4e2c5af5966f08e204))
* apply trailing refreshes and serialize session publications ([#46](https://github.com/aemard/prowl/issues/46)) ([0f89ba7](https://github.com/aemard/prowl/commit/0f89ba7e45d440bd814f5fa05766802336489fcc))
* **background:** stop the poll on rate limits and keep card failures local ([#59](https://github.com/aemard/prowl/issues/59)) ([a00f0de](https://github.com/aemard/prowl/commit/a00f0de854b5b682cf5410f417c20c00efa139c9))
* **detail:** drop a detail answer from an earlier request or sign-in ([#72](https://github.com/aemard/prowl/issues/72)) ([7a30c2b](https://github.com/aemard/prowl/commit/7a30c2beaf24eb5604cd0c1c0cdcfe3489f0d504))
* expose bounded coverage and preserve partial PR results ([#45](https://github.com/aemard/prowl/issues/45)) ([1c98b96](https://github.com/aemard/prowl/commit/1c98b9651db66cc87847f05da6d9bc70e4d6e163))
* **list:** mark a card seen only when it was really on screen at that version ([#75](https://github.com/aemard/prowl/issues/75)) ([04d1ac5](https://github.com/aemard/prowl/commit/04d1ac5357197bd968a774545b4f068db803b91c))
* **merge:** offer Merge only when it can succeed ([#68](https://github.com/aemard/prowl/issues/68)) ([fb6bd62](https://github.com/aemard/prowl/commit/fb6bd6268ed3a09606fc2664501d2369dcf615c9))
* **notify:** hold quiet-hours notifications until quiet hours end ([#60](https://github.com/aemard/prowl/issues/60)) ([07d1770](https://github.com/aemard/prowl/commit/07d1770c82392207e534724f67a7cd83f68dbe33))
* **notify:** notify each CI failure and recovery, also on the same commit ([#61](https://github.com/aemard/prowl/issues/61)) ([90188a6](https://github.com/aemard/prowl/commit/90188a684830794254b63445e0b20d20aeac566a))
* preserve review drafts and keep send errors inline ([#47](https://github.com/aemard/prowl/issues/47)) ([bf0d29b](https://github.com/aemard/prowl/commit/bf0d29b177ac4277fb57f75caf8e84feccb1cbd7))
* respect GitHub merge blockers and commit boundaries ([#44](https://github.com/aemard/prowl/issues/44)) ([2c41d6a](https://github.com/aemard/prowl/commit/2c41d6a17c9504ce90daa4de15e490d851c15c7e))
* **ui:** keep menus above the list, soften field focus, align the unseen dot ([#70](https://github.com/aemard/prowl/issues/70)) ([f0b3fd3](https://github.com/aemard/prowl/commit/f0b3fd3feb86af98c816c66bf0522d9023c22468))
* verify merge freshness and respect applied branch rules ([#67](https://github.com/aemard/prowl/issues/67)) ([ded1577](https://github.com/aemard/prowl/commit/ded157718d2bdfe789bdfc84fff30f8f9d10646f))


### Reverts

* discard quiet-hours notifications again ([#60](https://github.com/aemard/prowl/issues/60)) ([#64](https://github.com/aemard/prowl/issues/64)) ([152951a](https://github.com/aemard/prowl/commit/152951abb4936880f5c6876f234ab60a1369efd1))

## [1.4.0](https://github.com/aemard/prowl/compare/v1.3.1...v1.4.0) (2026-10-31)


### Features

* refresh PRs faster and renew Prowl's open source identity ([#38](https://github.com/aemard/prowl/issues/38)) ([de778cb](https://github.com/aemard/prowl/commit/de778cbbd39ddd344bc694be9c1e9cdcd28e17a9))

## [1.3.1](https://github.com/aemard/prowl/compare/v1.3.0...v1.3.1) (2026-10-08)


### Bug Fixes

* **release:** verifiable, signed releases and a higher Scorecard score ([#8](https://github.com/aemard/prowl/issues/8)) ([3777fc7](https://github.com/aemard/prowl/commit/3777fc77155d885e03d9f3dd592310f87eb492f6))

## [1.3.0](https://github.com/aemard/prowl/compare/v1.2.0...v1.3.0) (2026-10-08)


### Features

* parent teams, sign-in footer, faster polling ([#6](https://github.com/aemard/prowl/issues/6)) ([49e07ed](https://github.com/aemard/prowl/commit/49e07ed55f43017d338a7473ce8ee6358282a66f))

## [1.2.0](https://github.com/aemard/prowl/compare/v1.1.0...v1.2.0) (2026-10-08)


### Features

* v1.2 — bottom bar, team reviews, hidden PRs, repo grouping, permission guarantee ([#4](https://github.com/aemard/prowl/issues/4)) ([7a9d696](https://github.com/aemard/prowl/commit/7a9d6967e9637415e6f75f63871093d3fa23b3f6))

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

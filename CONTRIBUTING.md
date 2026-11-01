# Contributing

Prowl is open source under the MIT License, and fixes, features and docs are welcome. This page
is the short version. [`CLAUDE.md`](https://github.com/aemard/prowl/blob/main/CLAUDE.md),
[`docs/architecture.md`](https://github.com/aemard/prowl/blob/main/docs/architecture.md) and
[`docs/patterns.md`](https://github.com/aemard/prowl/blob/main/docs/patterns.md) hold the
details. Who decides and who holds which access is in
[`GOVERNANCE.md`](https://github.com/aemard/prowl/blob/main/GOVERNANCE.md).

## Before you start

Report a bug or suggest a feature in [GitHub issues](https://github.com/aemard/prowl/issues/new/choose)
(the templates ask for what helps: version, steps, what you expected). Open an issue for anything
bigger than a small fix, so we can agree on the approach before you write code. Prowl stays small on purpose: no backend, no telemetry, and GitHub is the only
remote host.

## Set up

You need Node 24 or newer (`.nvmrc`, so `nvm use` picks it) and [pnpm 12](https://pnpm.io/installation).
An older pnpm (10 or newer) downloads the version `packageManager` names by itself.

```sh
git clone https://github.com/aemard/prowl.git
cd prowl
pnpm install
pnpm build
```

Load the extension from `dist/`: open `chrome://extensions`, turn on Developer mode, choose Load
unpacked and pick the `dist` folder. `pnpm dev` rebuilds on every change; reload the extension on
`chrome://extensions` to pick it up.

## Check your work

| Command | What it does |
|---|---|
| `pnpm verify:fast` | Lint, file lengths, types and unit tests. Use it while you work. |
| `pnpm verify` | Everything CI runs: lint, file lengths, types, unit tests with coverage gates, build, size budget and end-to-end tests. |
| `pnpm lint:fix` | Formats the code with Biome and applies its safe fixes. |

A pull request needs a green `pnpm verify`. Tests never call the real GitHub API: they use the
builders in `tests/fixtures/` and the mock GitHub server of the end-to-end suite. The end-to-end
tests run in Playwright's Chromium (`pnpm exec playwright install chromium` once); set
`PROWL_CHROMIUM=/path/to/chromium` to use a Chromium you already have.

## Conventions

- TypeScript in strict mode, no `any`. Preact function components and signals.
- Every new feature and every bug fix comes with tests: a fix with one that fails without it.
  Tests sit next to the code they cover; test behavior, not every function. CI enforces coverage
  (80% overall, 95% for `src/lib/github` and `src/lib/diff`).
- Colors, spacing and type come from the tokens in `src/styles/tokens.css`.
- Everything is keyboard accessible and labelled, and axe reports no violations.
- Render GitHub text as text, never as HTML. Only open GitHub URLs.
- Write the least code that works: reuse what exists, prefer the platform, keep the diff short.
- Keep files to 400 lines (tests 800), functions to 80 lines and cognitive complexity to 15; CI
  checks all three. Split by responsibility, not by line count. A few older files are
  over and may only shrink (`BASELINE` in `scripts/check-file-size.mjs`).

## Dependencies

Packages come from npm through pnpm, pinned by `pnpm-lock.yaml` (CI installs with
`--frozen-lockfile`); GitHub Actions are pinned to commit SHAs. Add a dependency only when the
platform and the existing ones do not cover the need: a runtime one needs a line in
`docs/decisions.md` and has to fit the size budget, and one with an install script must be allowed
in `pnpm-workspace.yaml`. Dependabot proposes updates every week, dependency review fails a pull
request that adds a known-vulnerable package, and every release ships an SBOM.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/) for pull request titles:
`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `refactor:`, `perf:`, `chore:`, `build:`, `style:` or
`revert:`, with an optional lower-case scope and `!` for a breaking change. `main` accepts only
squash merges, and the repository defaults the final commit title to the PR title. The maintainer
checks this convention and keeps that title when merging; it is not automatically enforced.
Release Please reads this final commit: `feat` creates a minor release, `fix` a patch, and `!` a
major. Documentation, CI and maintenance changes alone do not normally create a release.
Keep a pull request to one change, say what it does and
why, and add a screenshot for anything users see.

Sign off every commit (`git commit -s`). The `Signed-off-by` line certifies the
[Developer Certificate of Origin](https://developercertificate.org/): you wrote the change, or
otherwise have the right to submit it under the MIT License. CI fails a pull request with a commit
that is not signed off (bots excepted); `git rebase --signoff main` adds the line to commits you
already made. A change written with an AI assistant is signed off by the person who submits it,
who answers for it.

GitHub automatically adds this DCO sign-off for web commits in this repository. It is distinct
from a cryptographic signature: `main` also requires verified commit signatures. For local
commits, configure SSH or GPG signing and use `git commit -S -s` to include both.

## The website

The site in `site/` is built with Astro. `pnpm --filter site build` builds it, and
`pnpm --filter site lighthouse` checks every page for a Lighthouse score of 95 or more in all four
categories (it needs Chrome: set `CHROME_PATH` if it is not found). The auth guide, the privacy
policy, the changelog and this page are rendered from `docs/auth.md`, `docs/privacy.md`,
`CHANGELOG.md` and `CONTRIBUTING.md`, so edit those files, not the site.

## Security

Never report a vulnerability in a public issue. Use GitHub's private reporting instead
(**Security → Report a vulnerability**), as [`SECURITY.md`](https://github.com/aemard/prowl/blob/main/SECURITY.md)
explains; you get an answer within 7 days.

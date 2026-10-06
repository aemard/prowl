# Contributing

Prowl is open source under the MIT License, and fixes, features and docs are welcome. This page
is the short version. [`CLAUDE.md`](https://github.com/aemard/prowl/blob/main/CLAUDE.md) and
[`docs/architecture.md`](https://github.com/aemard/prowl/blob/main/docs/architecture.md) hold the
details.

## Before you start

Open an issue for anything bigger than a small fix, so we can agree on the approach before you
write code. Prowl stays small on purpose: no backend, no telemetry, and GitHub is the only
remote host.

## Set up

You need Node 22 or newer and [pnpm](https://pnpm.io/installation).

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
| `pnpm verify:fast` | Lint, types and unit tests. Use it while you work. |
| `pnpm verify` | Everything CI runs: lint, types, unit tests with coverage gates, build, size budget and end-to-end tests. |
| `pnpm lint:fix` | Formats the code with Biome and applies its safe fixes. |

A pull request needs a green `pnpm verify`. Tests never call the real GitHub API: they use the
builders in `tests/fixtures/` and the mock GitHub server of the end-to-end suite.

## Conventions

- TypeScript in strict mode, no `any`. Preact function components and signals.
- Tests sit next to the code they cover. Test behavior, not every function.
- Colors, spacing and type come from the tokens in `src/styles/tokens.css`.
- Everything is keyboard accessible and labelled, and axe reports no violations.
- Render GitHub text as text, never as HTML. Only open GitHub URLs.
- A new runtime dependency needs a line in `docs/decisions.md` and has to fit the size budget.
- Write the least code that works: reuse what exists, prefer the platform, keep the diff short.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`,
`test:`, `ci:`, `refactor:`, `perf:` or `chore:`, with an optional scope. Release notes and
version numbers are generated from them. Keep a pull request to one change, say what it does and
why, and add a screenshot for anything users see.

## The website

The site in `site/` is built with Astro. `pnpm --filter site build` builds it, and
`pnpm --filter site lighthouse` checks every page for a Lighthouse score of 95 or more in all four
categories (it needs Chrome: set `CHROME_PATH` if it is not found). The auth guide, the privacy
policy, the changelog and this page are rendered from `docs/auth.md`, `docs/privacy.md`,
`CHANGELOG.md` and `CONTRIBUTING.md`, so edit those files, not the site.

## Security

Do not post exploit details in a public issue. Open an issue that says you found a security
problem, without the details, and a maintainer will arrange a private way to receive them.

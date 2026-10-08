# Releasing and publishing

## Extension releases

`release-please.yml` keeps a release pull request open on `main`. Merging it tags `vX.Y.Z`,
creates the GitHub release from `CHANGELOG.md` and calls `release-assets.yml`, which builds the
zip (`pnpm build && pnpm size && pnpm zip`), an SBOM and a provenance attestation and attaches
them to the release. If release-please cannot open pull requests, pushing a `v*` tag by hand runs
`release-tag.yml`, which creates the release and attaches the same assets; it refuses a tag on a
commit that is not on `main`. Releases start as drafts and are published once the assets are on,
so with immutable releases on, a published release and its tag can no longer change. The website's Install
button points to `releases/latest`, so the newest release is what visitors download.

One-time setup:

1. **Settings → Actions → General → Workflow permissions**: tick "Allow GitHub Actions to
   create and approve pull requests" (release-please opens the release PR with `GITHUB_TOKEN`).
2. Optional, for "Continue with GitHub": register an OAuth App with **Enable Device Flow** and
   store its client id as the repository variable `PROWL_GITHUB_CLIENT_ID` (Settings → Secrets
   and variables → Actions → Variables). Release builds bake it in; without it the zip supports
   token sign-in only.

Once the Chrome Web Store is set up, both paths then call `chrome-web-store.yml`, which submits
that release's zip to the store for Google's review, with no manual step. Setup and
troubleshooting: [chrome-web-store.md](chrome-web-store.md).

`release-please-config.json` pinned `"release-as": "1.0.0"` for the first release. It was removed
after v1.0.0 so later releases follow Conventional Commits (`feat` → minor, `fix` → patch).
Releases are reproducible: the zip is built from a clean checkout of the tag with a frozen
lockfile and no shared cache, and its file times are fixed in any timezone (`scripts/zip.mjs`).

## Verify a release

Anyone can check that a release zip comes from this repository's code:

```sh
# 1. It was built by release-assets.yml from this repository.
gh attestation verify prowl-vX.Y.Z.zip --repo aemard/prowl \
  --signer-workflow aemard/prowl/.github/workflows/release-assets.yml

# 2. Rebuilding the tag gives the same bytes (Node 24, pnpm 12).
git clone --branch vX.Y.Z https://github.com/aemard/prowl && cd prowl
pnpm install --frozen-lockfile
PROWL_GITHUB_CLIENT_ID=Ov23liIe68P7KdZbUzPD pnpm build && pnpm zip
shasum -a 256 prowl-vX.Y.Z.zip   # same as the release's zip
```

`PROWL_GITHUB_CLIENT_ID` is the public id of the OAuth App behind "Continue with GitHub"; it is in
every release zip (not a secret). Releases up to v1.3.0 match only when rebuilt with `TZ=UTC`.

To check a Chrome Web Store install, compare its files with the release zip: the extension's
folder is `Extensions/<id>/<version>_0` in your Chrome profile (`chrome://version` shows the
profile path). The store adds `_metadata/` (its own signature) and leaves every other file as is.

## Website

The site in `site/` is built with Astro and deployed by `.github/workflows/pages.yml` to
<https://aemard.github.io/prowl/>. The workflow runs on every push to `main` that touches
`site/**`, `docs/**`, `CHANGELOG.md`, `CONTRIBUTING.md`, `pnpm-lock.yaml` or the workflow itself, and by hand from the Actions tab
(workflow dispatch).

One-time repository setup (needs admin rights):

1. Open **Settings, Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

Without that, `actions/configure-pages` and `actions/deploy-pages` fail because Pages is not
enabled for the repository. No branch, token or secret is needed afterwards.

Build and preview locally:

```sh
pnpm --filter site build     # writes site/dist/
pnpm --filter site preview   # serves it at http://localhost:4321/prowl/
```

`pnpm --filter site lighthouse` builds the site, serves it like GitHub Pages and runs Lighthouse
(mobile profile) on every page. It fails when a page scores below 95 in performance,
accessibility, best practices or SEO. It needs Chrome: `CHROME_PATH=/path/to/chrome` if none is
found (CI uses the Chromium that Playwright installed). Use it after you add a page or an image.

The site shares files with the extension, so a change there shows up on the site on the next
build: `src/styles/tokens.css` (colors, spacing), `src/assets/logo.svg` (mark and favicon) and
`docs/screenshots/*.png` (the hero and the guides). Four pages render Markdown files at build time,
so edit those, not the site: `/auth/` is `docs/auth.md`, `/privacy/` is `docs/privacy.md`,
`/changelog/` is `CHANGELOG.md` (release-please keeps it current) and `/contributing/` is
`CONTRIBUTING.md`. `/install/` is written in `site/src/pages/install.astro`. `pnpm verify` also
builds the site.

## Dependency updates

Dependabot (`.github/dependabot.yml`) opens weekly pull requests for npm (development dependencies
grouped, a 2 day cooldown because pnpm refuses packages younger than a day) and for GitHub Actions.
`.github/workflows/dependabot-auto-merge.yml` then turns on auto-merge, with a squash, for the
pull requests that are **patch or minor updates of development dependencies or of GitHub Actions**.
Anything else stays for a person: runtime dependencies (Preact, `@preact/signals`, Astro, sharp),
every major update, and a group that contains even one of those. Auto-merge waits for the required
checks, so a red `Verify` run leaves the pull request open.

One-time setup (needs admin rights; without it the workflow fails or merges too early):

1. **Settings, General, Pull Requests**: tick **Allow auto-merge** and keep **Allow squash
   merging** on.
2. **Settings, Rules, Rulesets** (or Branches, branch protection) for `main`: require status
   checks to pass before merging and add **`Verify`** (the CI job; it is listed once CI has run on
   a pull request). Without a required check `gh pr merge --auto` has nothing to wait for and
   merges at once. Do not require approving reviews for these pull requests: nothing approves them.
3. **Settings, Actions, General, Workflow permissions** may stay on "Read repository contents": the
   job asks for `contents: write` and `pull-requests: write` itself.

To keep one pull request from merging by itself, press "Disable auto-merge" on it.

## Toolchain

- **Node** follows the newest Active LTS release: `.nvmrc` (used by CI, Pages, releases and the
  store upload), `engines.node` and `@types/node` move together. Node 24 until Node 26 turns LTS
  on 2026-10-28; then move all three to 26, run `pnpm verify` and update the README and
  CONTRIBUTING.
- **pnpm** is `packageManager` in `package.json` (`pnpm/action-setup` and a local pnpm 10 or newer
  read it). Build scripts of dependencies are decided in `pnpm-workspace.yaml` (`allowBuilds`);
  a new dependency with an install script fails `pnpm install` until it is listed there.
- **Playwright's browser** is installed by CI (`playwright install chromium`, cached by Playwright
  version). On a machine that has a Chromium but not Playwright's build, set
  `PROWL_CHROMIUM=/path/to/chromium` before `pnpm e2e`, `pnpm screenshots`, `pnpm icons` or
  `pnpm store-images`. CI leaves it unset.

## Recommended repository settings

- **`main` ruleset**: pull request required (squash, no approval: nothing could approve the
  maintainer's own), signed commits, `Verify` and CodeQL `Analyze` required, no force push or
  deletion; admins bypass only through a pull request.
- **`v*` tag ruleset**: no update or deletion. Creation stays open because release-please creates
  tags with `GITHUB_TOKEN`, which a personal repository's ruleset cannot exempt; `release-tag.yml`
  checks instead that a hand-pushed tag is on `main`.
- **Immutable releases** (Settings → General → Releases), private vulnerability reporting,
  Dependabot alerts and security updates, and Actions limited to GitHub's own and the pinned
  third-party actions with SHA pinning required.

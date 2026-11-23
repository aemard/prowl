# Releasing and publishing

## Extension releases

`release-please.yml` keeps a release pull request open on `main`. Merging it tags `vX.Y.Z`,
creates the GitHub release from `CHANGELOG.md` and calls `release-assets.yml`, which builds the
zip (`pnpm build && pnpm size && pnpm zip`), an SBOM and a provenance attestation and attaches
them to the release. If release-please cannot open pull requests, pushing a `v*` tag by hand runs
`release-tag.yml`, which creates the release and attaches the same assets; it refuses a tag on a
commit that is not on `main`. Releases start as drafts and are published once the assets are on,
so with immutable releases on, a published release and its tag can no longer change. The website's and the
README's install links point to the Chrome Web Store listing; the zip path uses `releases/latest`.

One-time setup:

1. **Settings → Actions → General → Workflow permissions**: tick "Allow GitHub Actions to
   create and approve pull requests" (release-please opens the release PR with `GITHUB_TOKEN`).
2. Optional, for "Continue with GitHub": register an OAuth App with **Enable Device Flow** and
   store its client id as the repository variable `PROWL_GITHUB_CLIENT_ID` (Settings → Secrets
   and variables → Actions → Variables). Release builds bake it in; without it the zip supports
   token sign-in only.

Once the Chrome Web Store is set up, both paths then call `chrome-web-store.yml`, which waits
for a maintainer's approval and submits that release's zip to the store. Setup and
troubleshooting: [chrome-web-store.md](chrome-web-store.md).

`release-please-config.json` pinned `"release-as": "1.0.0"` for the first release. It was removed
after v1.0.0 so later releases follow Conventional Commits (`feat` → minor, `fix` → patch).
`main` allows only squash merges, and the default squash title is the PR title. Preserve it in
the merge dialog so Release Please reads the intended type and breaking-change marker. The
commit body keeps the individual commit messages and their DCO sign-offs. The maintainer can
still edit the final title or use the ruleset's admin bypass; this is not an immutable
server-side commit-message restriction.

Releases are reproducible: the zip is built from a clean checkout of the tag with a frozen
lockfile and no shared cache, and its file times are fixed in any timezone (`scripts/zip.mjs`).

## Verify a release

Anyone can check that a release zip comes from this repository's code:

```sh
# 1. It was built by release-assets.yml from this repository.
gh attestation verify prowl-vX.Y.Z.zip --repo aemard/prowl \
  --signer-workflow aemard/prowl/.github/workflows/release-assets.yml
# Offline, with the bundle attached to the release (v1.3.1 and later):
gh attestation verify prowl-vX.Y.Z.zip --repo aemard/prowl \
  --bundle prowl-vX.Y.Z.zip.sigstore.json \
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
build: `src/styles/tokens.css` (colors, spacing), `src/assets/logo.png` (mark and favicon) and
`docs/screenshots/*.png` (the hero and the guides). Four pages render Markdown files at build time,
so edit those, not the site: `/auth/` is `docs/auth.md`, `/privacy/` is `docs/privacy.md`,
`/changelog/` is `CHANGELOG.md` (release-please keeps it current) and `/contributing/` is
`CONTRIBUTING.md`. `/install/` is written in `site/src/pages/install.astro`. `pnpm verify` also
builds the site.

## Dependency updates

Dependabot (`.github/dependabot.yml`) opens weekly pull requests for npm (a 2 day cooldown because
pnpm refuses packages younger than a day) and for GitHub Actions. Development dependencies come in
two groups: `test-tooling` (what tests, lints and type-checks: never run by a release) and
`build-chain` (everything else: Vite and its plugins, fflate, the website's packages, any new
tool). `.github/workflows/dependabot-auto-merge.yml` turns on auto-merge, with a squash, only for:

- a **patch or minor update of the `test-tooling` group** that changes nothing but `package.json`
  and `pnpm-lock.yaml` and leaves every package the release is built with (transitive ones
  included) where it was: `node scripts/build-chain.mjs` lists them, from the base branch, for
  both lockfiles;
- a **patch or minor update of an Action** used only by `ci.yml`, `codeql.yml` or
  `dependency-review.yml`, which hold no release permission and no secret.

Anything else waits for a person, and the workflow's summary says why: the `build-chain` group,
runtime dependencies (Preact, `@preact/signals`, Astro, sharp), every major update, transitive
security updates, and any Action that also runs in a release, store or Pages workflow
(`actions/checkout`, `setup-node`, `pnpm/action-setup`...). Review those as release changes:
read the changelog and the diff of the lockfile. Auto-merge waits for the required checks, so a red
`Verify` run leaves the pull request open. The reasons are in docs/decisions.md (2026-11-22).

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

A Dependabot pull request that stays open is one of these:

- **Left for a person on purpose**: the build chain, a runtime dependency (Astro, Preact…), a
  major update or an Action of the release path. The workflow does not turn auto-merge on and its
  run summary names the reason; review and merge it by hand.
- **A red required check**: auto-merge waits for green. A new tool version that reformats or
  lints differently (Biome) needs a fix on `main` first; Dependabot then rebases its pull request.
  Actions that must move together (`github/codeql-action` `init` and `analyze`) are grouped in
  `dependabot.yml` for that reason.
- **Auto-merge turned off by GitHub** although every check is green: the pull request's timeline
  says so ("disabled auto-merge"). Merge it by hand, or comment `@dependabot rebase` to run it
  again.

A merge that auto-merge makes is GitHub's on behalf of the workflow's `GITHUB_TOKEN`, and events
of that token start no workflow: the push to `main` runs neither CI, CodeQL nor Release Please.
That is accepted: these updates change nothing that ships, `Verify` ran on the pull request, and
the next push to `main` runs all three over everything merged since (Release Please reads every
commit since the last release). To refresh them sooner, run **CI** or **Release Please** by hand
(Actions, the workflow, "Run workflow"). Making the merge trigger them would need a personal
token or a GitHub App secret in this workflow, which is what it is built to avoid.

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
  maintainer's own), signed commits, `Verify` and CodeQL `Analyze` required on an up-to-date
  branch, review discussions resolved, no force push or deletion; admins bypass only through a
  pull request.
- **Settings → General**: under Pull Requests, set the squash "Default commit message" to "Pull
  request title and commit details" (the PR title becomes the commit title, the body keeps each
  commit message and its sign-off); under Commits, tick "Require contributors to sign off on
  web-based commits" (a DCO sign-off, separate from the verified signature GitHub adds to a squash
  commit).
- **`v*` tag ruleset**: no update or deletion. Creation stays open because release-please creates
  tags with `GITHUB_TOKEN`, which a personal repository's ruleset cannot exempt; `release-tag.yml`
  checks instead that a hand-pushed tag is on `main`.
- **Immutable releases** (Settings → General → Releases), private vulnerability reporting,
  Dependabot alerts and security updates, and Actions limited to GitHub's own and the pinned
  third-party actions with SHA pinning required.

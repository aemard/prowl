# Releasing and publishing

## Extension releases

`release-please.yml` keeps a release pull request open on `main`. Merging it tags `vX.Y.Z`,
creates the GitHub release from `CHANGELOG.md` and calls `release-assets.yml`, which builds the
zip (`pnpm build && pnpm size && pnpm zip`), an SBOM and a provenance attestation and attaches
them to the release. If release-please cannot open pull requests, pushing a `v*` tag by hand runs
`release-tag.yml`, which creates the release and attaches the same assets. The website's Install
button points to `releases/latest`, so the newest release is what visitors download.

One-time setup:

1. **Settings → Actions → General → Workflow permissions**: tick "Allow GitHub Actions to
   create and approve pull requests" (release-please opens the release PR with `GITHUB_TOKEN`).
2. Optional, for "Continue with GitHub": register an OAuth App with **Enable Device Flow** and
   store its client id as the repository variable `PROWL_GITHUB_CLIENT_ID` (Settings → Secrets
   and variables → Actions → Variables). Release builds bake it in; without it the zip supports
   token sign-in only.

`release-please-config.json` pins `"release-as": "1.0.0"` for the first release. Remove it right
after v1.0.0 so later releases follow Conventional Commits (`feat` → minor, `fix` → patch).
Releases are reproducible: the zip is built from a clean checkout of the tag with a frozen
lockfile and no shared cache, and its file times are fixed (`scripts/zip.mjs`).

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

## Recommended repository settings

- **Protect release tags**: Settings → Rules → Rulesets → new tag ruleset for `v*` restricting
  creation, update and deletion to maintainers, so only intended releases get signed assets.
- **Verify a download**: `gh attestation verify prowl-vX.Y.Z.zip --repo aemard/prowl
  --signer-workflow aemard/prowl/.github/workflows/release-assets.yml`.

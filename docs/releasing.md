# Releasing and publishing

## Extension releases

`release-please.yml` keeps a release pull request open on `main`. Merging it tags `vX.Y.Z`,
creates the GitHub release from `CHANGELOG.md` and calls `release-assets.yml`, which builds the
zip (`pnpm build && pnpm size && pnpm zip`), an SBOM and a provenance attestation and attaches
them to the release. If release-please cannot open pull requests, pushing a `v*` tag by hand runs
`release-tag.yml`, which creates the release and attaches the same assets. The website's Install
button points to `releases/latest`, so the newest release is what visitors download.

## Website

The site in `site/` is built with Astro and deployed by `.github/workflows/pages.yml` to
<https://aemard.github.io/prowl/>. The workflow runs on every push to `main` that touches
`site/**`, `docs/**`, `pnpm-lock.yaml` or the workflow itself, and by hand from the Actions tab
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

The site shares files with the extension, so a change there shows up on the site on the next
build: `src/styles/tokens.css` (colors, spacing), `src/assets/logo.svg` (mark and favicon) and
`docs/screenshots/list-light.png` / `list-dark.png` (the hero). `pnpm verify` also builds the site.

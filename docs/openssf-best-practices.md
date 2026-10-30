# OpenSSF Best Practices badge

Prowl holds the [OpenSSF Best Practices](https://www.bestpractices.dev/projects/16092) **passing**
badge and answers the **silver** and **Baseline level 1 and 2** criteria too. The answers live in
[`.bestpractices.json`](../.bestpractices.json), at the root of the repository: one
`<criterion>_status` (`Met`, `Unmet` or `N/A`) and one `<criterion>_justification`, with the
evidence and its URL, per criterion. Baseline controls are written in lowercase with underscores
(`OSPS-AC-01.01` is `osps_ac_01_01`). bestpractices.dev reads that file and proposes its answers in
the form ([how](https://github.com/coreinfrastructure/best-practices-badge/blob/main/docs/bestpractices-json.md)).
Keep it true: a criterion that stops being met is fixed in the project, not left stale here.

## Applying

1. Sign in at <https://www.bestpractices.dev>, open
   [project 16092](https://www.bestpractices.dev/projects/16092) and choose **Edit**.
2. Pick the level (Passing, Silver, Gold, or Baseline 1 to 3) and open each section. Press the
   robot-emoji **Save** button once so the site reads `.bestpractices.json` again, check each
   proposed answer and press **Save (and continue)**.
3. The badge moves up once every MUST of a level is Met (or N/A where allowed). A SHOULD may stay
   Unmet with its justification. OpenSSF Scorecard's `CII-Best-Practices` check reads the level on
   its next run.

Before submitting silver, the maintainer names a successor in GitHub (Settings → Account →
Successor settings), which `access_continuity` relies on.

## Unmet, and why

- Silver SHOULDs: `bus_factor` (one maintainer), `internationalization` (English only, on the
  roadmap) and `version_tags_signed` (release-please tags through the API, unsigned).
- Gold and Baseline level 3 need a second person: gold asks for a bus factor of 2, two
  unassociated significant contributors and a non-author review of half the changes, and
  `OSPS-QA-07.01` a non-author approval before every merge. Gold's `hardened_site` also needs
  security headers that GitHub Pages cannot send. The other gold criteria (2FA, per-file copyright
  and SPDX license lines, documented review standards, small tasks for newcomers) can wait until a
  second maintainer joins: without one, the level stays out of reach.

## What changed to meet them

- Passing: CONTRIBUTING.md states how to report a bug, the test policy and private vulnerability
  reporting; the pull request template asks to confirm that changes come with tests.
- Silver and Baseline: [`GOVERNANCE.md`](../GOVERNANCE.md) (roles, access to sensitive resources,
  continuity), the [roadmap](status.md#roadmap), the assurance case in the
  [threat model](security/threat-model.md#assurance-case), the dependency policy in
  CONTRIBUTING.md, and the Developer Certificate of Origin: every commit is signed off, and the
  `Verify` check fails a pull request with a commit that is not.

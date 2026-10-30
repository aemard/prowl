# OpenSSF Best Practices badge

Prowl's answers to the 67 criteria of the [OpenSSF Best Practices](https://www.bestpractices.dev)
**passing** level live in [`.bestpractices.json`](../.bestpractices.json), at the root of the
repository: one `<criterion>_status` (`Met` or `N/A`) and one `<criterion>_justification`, with the
evidence and its URL, per criterion. bestpractices.dev reads that file and proposes its answers in
the form ([how](https://github.com/coreinfrastructure/best-practices-badge/blob/main/docs/bestpractices-json.md)).
Keep it true: a criterion that stops being met is fixed in the project, not left stale here.

## Applying

1. Sign in at <https://www.bestpractices.dev> with the maintainer's GitHub account, choose
   **Get Your Badge Now!** and enter `https://github.com/aemard/prowl`.
2. Open each section of the passing level (Basics, Change Control, Reporting, Quality, Security,
   Analysis). The answers from `.bestpractices.json` are filled in as proposals: check them and
   press **Save (and continue)**. Use the robot-emoji Save button to read the file again after
   changing it.
3. Once every MUST is Met (or N/A where allowed), the badge turns to **passing**. Add it to the
   README with the project id the site gives
   (`[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/<id>/badge)](https://www.bestpractices.dev/projects/<id>)`).
   OpenSSF Scorecard's `CII-Best-Practices` check reads it on its next run.

## What changed to meet them

- CONTRIBUTING.md states how to report a bug, the test policy (every feature and fix comes with
  tests, coverage gates in CI) and private vulnerability reporting.
- The pull request template asks to confirm that new behavior and fixes come with tests.

Twelve criteria are N/A: the nine cryptography ones (Prowl implements none; Chrome does TLS),
`release_notes_vulns` and `vulnerability_report_response` (no vulnerability fixed or reported yet)
and `dynamic_analysis_unsafe` (TypeScript is memory-safe).

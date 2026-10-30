# OpenSSF Best Practices badge

Prowl's answers to the 67 criteria of the [OpenSSF Best Practices](https://www.bestpractices.dev)
**passing** level, with the evidence for each, ready to paste into the form. Keep them in step with
the repository: a criterion that stops being met should be fixed, not left stale here.

## Applying

1. Sign in at <https://www.bestpractices.dev> with the maintainer's GitHub account, choose
   **Get Your Badge Now!** and enter `https://github.com/aemard/prowl`. The site fills in what it
   can detect from the repository.
2. Go through each section and set every criterion to the answer below, pasting the justification
   (and URL, where the form asks for one). Save after each section.
3. Once every MUST is Met (or N/A where allowed), the badge turns to **passing**. Add it to the
   README with the project id the site gives
   (`[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/<id>/badge)](https://www.bestpractices.dev/projects/<id>)`).
   OpenSSF Scorecard's `CII-Best-Practices` check reads it on its next run.

Links below are relative to <https://github.com/aemard/prowl>.

## Basics

| Criterion | Answer | Justification |
|---|---|---|
| `description_good` | Met | The README and https://aemard.github.io/prowl/ open with what Prowl does: a Chrome side panel that shows the live state of your GitHub pull requests, notifies on changes and lets you act on them. |
| `interact` | Met | The README links the Chrome Web Store listing and the releases (obtain), GitHub issues with bug and feature templates (feedback) and CONTRIBUTING.md (contribute). |
| `contribution` | Met | https://github.com/aemard/prowl/blob/main/CONTRIBUTING.md: issues first for bigger changes, then pull requests that pass `pnpm verify`, with Conventional Commits. |
| `contribution_requirements` | Met | https://github.com/aemard/prowl/blob/main/CONTRIBUTING.md#conventions: TypeScript strict, Biome formatting and lint, tests with every change, accessibility (axe), design tokens, no HTML from GitHub text. |
| `floss_license` | Met | MIT License. |
| `floss_license_osi` | Met | MIT is OSI-approved. |
| `license_location` | Met | https://github.com/aemard/prowl/blob/main/LICENSE |
| `documentation_basics` | Met | README (install, sign in, features, privacy), the sign-in guide (docs/auth.md), the install guide on https://aemard.github.io/prowl/install/, and docs/ for architecture and decisions. |
| `documentation_interface` | Met | Prowl's external interfaces are its UI, its permissions and the GitHub API calls it makes. The README and docs/privacy.md document the permissions and data; docs/auth.md the sign-in inputs; docs/architecture.md every GitHub query and mutation Prowl sends. |
| `sites_https` | Met | The repository, website (GitHub Pages) and downloads (GitHub releases, Chrome Web Store) are HTTPS only. |
| `discussion` | Met | GitHub issues: searchable, each issue has a URL, anyone with a GitHub account can take part, no proprietary client needed. |
| `english` | Met | All documentation, code comments and issue templates are in English. |
| `maintained` | Met | Active development: weekly dependency updates, releases v1.0.0 to v1.3.1 in October 2026, security review entries in docs/security/review.md. |

## Change control

| Criterion | Answer | Justification |
|---|---|---|
| `repo_public` | Met | https://github.com/aemard/prowl |
| `repo_track` | Met | Git on GitHub records every change with its author and date; `main` takes changes only through pull requests with signed commits. |
| `repo_interim` | Met | Every change is merged to `main` between releases; release-please keeps an open release pull request. |
| `repo_distributed` | Met | Git. |
| `version_unique` | Met | Each release has a unique Semantic Versioning number (v1.0.0 to v1.3.1), also in the manifest. |
| `version_semver` | Met | SemVer, derived from Conventional Commits by release-please. |
| `version_tags` | Met | Every release is a `vX.Y.Z` tag; a ruleset forbids moving or deleting them. |
| `release_notes` | Met | https://github.com/aemard/prowl/blob/main/CHANGELOG.md and the GitHub release pages summarize each release's features and fixes. |
| `release_notes_vulns` | N/A | No release has fixed a publicly known vulnerability (CVE or similar) in Prowl's own code. Fixed advisories would be listed in the release notes and a GitHub security advisory (SECURITY.md). |

## Reporting

| Criterion | Answer | Justification |
|---|---|---|
| `report_process` | Met | https://github.com/aemard/prowl/issues/new/choose (bug report and feature request templates), described in CONTRIBUTING.md. |
| `report_tracker` | Met | GitHub issues. |
| `report_responses` | Met | No bug report has been submitted yet; the maintainer watches the issue tracker and answers every report. |
| `enhancement_responses` | Met | No enhancement request has been submitted yet; requests are answered in the issue tracker. |
| `report_archive` | Met | https://github.com/aemard/prowl/issues (public, searchable, including closed issues). |
| `vulnerability_report_process` | Met | https://github.com/aemard/prowl/blob/main/SECURITY.md |
| `vulnerability_report_private` | Met | GitHub private vulnerability reporting: https://github.com/aemard/prowl/security/advisories/new, as SECURITY.md and CONTRIBUTING.md say; the issue chooser links it too. |
| `vulnerability_report_response` | N/A | No vulnerability report received in the last 6 months. SECURITY.md commits to an answer within 7 days. |

## Quality

| Criterion | Answer | Justification |
|---|---|---|
| `build` | Met | `pnpm build` (Vite) rebuilds the extension from source; `pnpm zip` packages it. Release zips rebuild byte for byte (docs/releasing.md). |
| `build_common_tools` | Met | Node.js, pnpm and Vite. |
| `build_floss_tools` | Met | Every build tool is FLOSS (Node.js, pnpm, Vite, TypeScript, Biome). |
| `test` | Met | Vitest unit tests and Playwright end-to-end tests against the built extension, MIT like the code. `pnpm verify` runs everything (CONTRIBUTING.md); CI runs it on every pull request (.github/workflows/ci.yml). |
| `test_invocation` | Met | `pnpm test`, `pnpm e2e` and `pnpm verify`, the standard npm-scripts way. |
| `test_most` | Met | Over 1,300 unit tests and over 100 end-to-end tests; coverage is about 99% of statements, with CI gates at 80% overall and 95% for the GitHub client and diff engine. |
| `test_continuous_integration` | Met | GitHub Actions runs lint, types, unit tests with coverage gates, build, size budget, end-to-end tests and Lighthouse on every push and pull request; `Verify` is required to merge. |
| `test_policy` | Met | CONTRIBUTING.md#conventions: every new feature and every bug fix comes with tests, a fix with one that fails without it; CI enforces coverage. |
| `tests_are_added` | Met | Recent features came with tests, e.g. pull request #32 (token expiry, SAML notice, Trusted Types E2E check, merge dialog blockers). |
| `tests_documented_added` | Met | The pull request template asks to confirm that new behavior and fixes come with tests; CONTRIBUTING.md states the policy. |
| `warnings` | Met | TypeScript in strict mode and Biome (lint with the recommended rules plus a11y and security rules) in CI (`biome ci`). |
| `warnings_fixed` | Met | CI fails on any type error or Biome error; `main` has none. |
| `warnings_strict` | Met | `strict: true`, no `any`, Biome a11y rules at error level, `noDangerouslySetInnerHtml` as an error. |

## Security

| Criterion | Answer | Justification |
|---|---|---|
| `know_secure_design` | Met | The maintainer applies least privilege (manifest permissions locked by tests, no host access beyond GitHub), fail-safe defaults (strict CSP with Trusted Types, URL allowlist), complete mediation of untrusted GitHub data and a STRIDE threat model: docs/security/threat-model.md. |
| `know_common_errors` | Met | The threat model lists the extension's common vulnerability classes (XSS through untrusted text, token leaks, open redirects, over-broad permissions, supply chain) with a mitigation and test for each. |
| `crypto_published` | N/A | Prowl implements no cryptography; HTTPS and storage are provided by Chrome. |
| `crypto_call` | N/A | Prowl implements no cryptography; Chrome handles TLS. |
| `crypto_floss` | N/A | Prowl implements no cryptography. |
| `crypto_keylength` | N/A | Prowl implements no cryptography. |
| `crypto_working` | N/A | Prowl implements no cryptography. |
| `crypto_weaknesses` | N/A | Prowl implements no cryptography. |
| `crypto_pfs` | N/A | Prowl implements no key agreement; Chrome's TLS to GitHub provides forward secrecy. |
| `crypto_password_storage` | N/A | Prowl stores no passwords of external users. |
| `crypto_random` | N/A | Prowl generates no cryptographic keys or nonces. |
| `delivery_mitm` | Met | Delivered through the Chrome Web Store and GitHub releases over HTTPS; release zips carry a signed build provenance attestation (`gh attestation verify`). |
| `delivery_unsigned` | Met | No hash is fetched over HTTP; release integrity is checked through Sigstore-signed attestations over HTTPS. |
| `vulnerabilities_fixed_60_days` | Met | No known unpatched vulnerability: `pnpm audit --prod` reports none, Dependabot and dependency review run on every change. |
| `vulnerabilities_critical_fixed` | Met | Advisories are fixed as soon as they are known (e.g. the toolchain advisories of October 2026, docs/security/review.md). |
| `no_leaked_credentials` | Met | No credentials in the repository: tests use fake tokens, and the store upload signs in to Google through OIDC (Workload Identity Federation) instead of a stored key. |

## Analysis

| Criterion | Answer | Justification |
|---|---|---|
| `static_analysis` | Met | CodeQL (security-extended queries, JavaScript/TypeScript and Actions) runs on every pull request, every push to `main` and weekly, and is required to merge; Biome lints every change. |
| `static_analysis_common_vulnerabilities` | Met | CodeQL's security-extended suite covers XSS, injection, insecure URL handling and the other common JavaScript vulnerability classes. |
| `static_analysis_fixed` | Met | CodeQL findings are fixed or triaged as false positives with a reason (docs/security/review.md). |
| `static_analysis_often` | Met | CodeQL runs on every commit to a pull request and to `main`. |
| `dynamic_analysis` | Met | Playwright end-to-end tests drive the built extension in Chromium against a mock GitHub (with axe accessibility scans), and fast-check fuzzes the trust boundaries (tests/unit/fuzz.test.ts), before every release. |
| `dynamic_analysis_unsafe` | N/A | Prowl is written in TypeScript, a memory-safe language. |
| `dynamic_analysis_enable_assertions` | Met | Tests and fuzzing run with assertions throughout (Vitest and Playwright `expect`, property checks); production builds carry none. |
| `dynamic_analysis_fixed` | Met | Failures found by end-to-end tests or fuzzing block the pull request until fixed. |

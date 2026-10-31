# Governance

Prowl has one maintainer, Arthur Emard ([@aemard](https://github.com/aemard)), who decides what
goes in. Discussion happens in public, in issues and pull requests. Decisions that shape the code
are written down with their reason in [`docs/decisions.md`](docs/decisions.md), and the plan for
the next year is the [roadmap](docs/status.md#roadmap).

## Roles

| Role | Who | Responsibilities |
|---|---|---|
| Maintainer | @aemard | Triages issues, reviews and merges pull requests, sets the roadmap, cuts releases and approves each Chrome Web Store submission, answers vulnerability reports ([`SECURITY.md`](SECURITY.md)), holds the accounts listed below |
| Contributor | Anyone with a GitHub account | Opens issues and pull requests as [`CONTRIBUTING.md`](CONTRIBUTING.md) describes, and signs off every commit (DCO) |
| AI agents | Claude Code, at the maintainer's request | Write changes on branches and open pull requests. They cannot merge, approve a store submission or change settings; the maintainer reviews what they open and answers for it |
| Bots | Dependabot, release-please, CodeQL, Scorecard | Open dependency and release pull requests and report findings, each with the least workflow `permissions` it needs |

The maintainer invites a contributor as a collaborator after sustained contributions, with the
lowest role their work needs (Triage, then Write). Admin rights and the accounts below go only to
a maintainer, who must use two-factor authentication.

## Access to sensitive resources

| Resource | Who has access |
|---|---|
| GitHub repository: admin, rulesets, variables, environments | @aemard |
| `chrome-web-store` environment (approves a store submission) | @aemard |
| Chrome Web Store developer account, and the Google Cloud project behind its Workload Identity Federation | @aemard |
| GitHub OAuth App behind "Continue with GitHub" | @aemard |
| Private vulnerability reports (GitHub security advisories) | @aemard |

The repository stores no long-lived secret: the store job gets a short-lived Google token through
Workload Identity Federation, and every other workflow uses `GITHUB_TOKEN`.

## Continuity

As of 2026-10-31, no successor or emergency access procedure has been established. The
project does not yet meet the OpenSSF Silver `access_continuity` criterion, which requires
issues, changes and releases to continue within one week after loss of its only maintainer.

To close this gap, the maintainer must designate a trusted person and document and validate
how that person obtains the necessary authority and access to the repository and publishing
accounts. Credentials and recovery material must not be stored in this repository. Naming a
GitHub successor alone does not demonstrate recovery of all publishing access within a week.

Until that is in place:

- The workflows, rulesets and release process ([`docs/releasing.md`](docs/releasing.md)) are
  public, so another person can build and release a fork; this does not grant control of the
  existing repository or accounts.
- The Chrome Web Store listing belongs to the maintainer's developer account. Until a second
  publisher is added, a successor ships releases on GitHub (zip, SBOM, provenance) and can publish
  them under a new store listing.
- The code is under the MIT License, so anyone can also fork it and carry on.

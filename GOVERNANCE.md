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

If the maintainer dies or can no longer work on Prowl:

- The maintainer's GitHub account names a successor (Settings → Account → Successor settings).
  Once GitHub confirms the loss, the successor can take over the repository and then triage issues,
  merge pull requests and publish releases: the workflows, rulesets and the release process
  ([`docs/releasing.md`](docs/releasing.md)) all live in the repository.
- The Chrome Web Store listing belongs to the maintainer's developer account. Until a second
  publisher is added, a successor ships releases on GitHub (zip, SBOM, provenance) and can publish
  them under a new store listing.
- The code is under the MIT License, so anyone can also fork it and carry on.

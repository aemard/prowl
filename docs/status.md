# Status

**Latest release**: [on GitHub](https://github.com/aemard/prowl/releases/latest) and on the
[Chrome Web Store](https://chromewebstore.google.com/detail/prowl/homnofbclfgoailffidcbgekohciglcf).
Every release ships its zip, an SBOM and a provenance attestation, and rebuilds byte for byte
([verify a release](releasing.md#verify-a-release)). What changed is in the
[changelog](../CHANGELOG.md); this page tracks what is left, in priority order.

## Needs the maintainer (repository settings)

1. **OAuth App client id** (`PROWL_GITHUB_CLIENT_ID` repository variable): release builds offer
   "Continue with GitHub" only with it; without it they support token sign-in.
2. **Edge Add-ons** (optional): create the product and the Publish API credentials, then the
   `edge-add-ons` environment ([setup](chrome-web-store.md#microsoft-edge-add-ons)).
3. **Dependabot alerts and security updates** on (Settings, Advanced Security): the weekly
   version updates do not cover an advisory published against a lockfile that has not changed.

## Roadmap

What Prowl plans to do from November 2026 to October 2027, in priority order. It is a plan, not a
promise: issues track the progress.

Done since 1.5.0 (next release): the Your turn section, badge and notification; merge queues
(add, position, remove); GitHub stacks as one list item with "Merge K of N"; review
conversations (reply, resolve); deployments of the head commit; optional on-device AI
(summaries, failing-check explanations); fast updates (notifications check every minute,
catch-up on open, CI watch); the quiet-hours digest; and publishing releases to Edge Add-ons.

1. Verify against live GitHub what the mock cannot, the newest first: GitHub stacks
   (`stackEntry` and the asynchronous `merge-async` API, both recent; a refused `stackEntry`
   already degrades to a list without stacks), merge-queue positions and estimates, and the
   notifications check: with fine-grained tokens, and that GitHub answers 304 to its
   `If-Modified-Since` without spending points (the worker's `X-RateLimit-Remaining` before and
   after an unchanged check; Chromium's pass-through of the 304 is covered in E2E), and that
   `/notifications` and GraphQL report separate budgets. Then branch-protection fields readable by
   non-admin tokens ("1 approval required"), exact merge refusal wording, the Chrome permission
   prompt for the device flow, CI visibility with fine-grained tokens, and the wording of the
   SAML errors and of `GitHub-Authentication-Token-Expiration` that Prowl reads.
2. GitHub Enterprise Server support (custom API/web origins as optional host permissions).

The extension supports English, Japanese, Simplified and Traditional Chinese, French, German
and Spanish. Choose a language in Settings → List → Language, or follow Chrome.

What Prowl will not do: run a backend or any server of its own, collect telemetry, talk to a host
other than GitHub, or read the pages you browse.

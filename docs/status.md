# Status

**Latest release**: [v1.3.1](https://github.com/aemard/prowl/releases/tag/v1.3.1) (2026-10-08),
on the [Chrome Web Store](https://chromewebstore.google.com/detail/prowl/homnofbclfgoailffidcbgekohciglcf).
Every release ships its zip, an SBOM and a provenance attestation, and rebuilds byte for byte
([verify a release](releasing.md#verify-a-release)). What changed is in the
[changelog](../CHANGELOG.md); this page tracks what is left, in priority order.

## Needs the maintainer (repository settings)

1. **OAuth App client id** (`PROWL_GITHUB_CLIENT_ID` repository variable): release builds offer
   "Continue with GitHub" only with it; without it they support token sign-in.
2. **Dependabot alerts and security updates** on (Settings, Advanced Security): the weekly
   version updates do not cover an advisory published against a lockfile that has not changed.

## Next

1. Verify against live GitHub what the mock cannot: branch-protection fields readable by
   non-admin tokens ("1 approval required"), exact merge refusal wording, the Chrome permission
   prompt for the device flow, CI visibility with fine-grained tokens, and the wording of the
   SAML errors and of `GitHub-Authentication-Token-Expiration` that Prowl reads.
2. GitHub Enterprise Server support (custom API/web origins as optional host permissions).
3. Merge queues (today GitHub's refusal is shown as is).
4. Localization (strings are in components; English only).

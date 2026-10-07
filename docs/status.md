# Status

## v1.0.0 release (2026-10-06)

**Released**: [v1.0.0](https://github.com/aemard/prowl/releases/tag/v1.0.0)

**Assets**:
- `prowl-v1.0.0.zip` (72,351 bytes)
- `prowl-v1.0.0.sbom.spdx.json`
- Provenance attestation ([GitHub](https://github.com/aemard/prowl/releases/tag/v1.0.0) → Release assets → Provenance)

v1.0.0 scope is complete: every story in `prd.json` passes. This page tracks what is left
outside the v1 scope, in priority order.

## Needs the maintainer (repository settings)

1. **Protect `v*` tags** with a ruleset so only maintainers can cut signed releases.
2. **OAuth App client id** (`PROWL_GITHUB_CLIENT_ID` repository variable) to enable
   "Continue with GitHub" in release builds; until then, release zips support token sign-in.

## Next (post v1)

1. Chrome Web Store listing: publishing is automated after approval; the maintainer creates the
   item and the Google access once (`docs/chrome-web-store.md`).
2. Verify against live GitHub what the mock cannot: branch-protection fields readable by
   non-admin tokens ("1 approval required"), exact merge refusal wording, the Chrome permission
   prompt for the device flow, and CI visibility with fine-grained tokens.
3. GitHub Enterprise Server support (custom API/web origins as optional host permissions).
4. Merge queue and auto-merge (today GitHub's refusal is shown as is).
5. Localization (strings are in components; English only).

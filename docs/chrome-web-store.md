# Chrome Web Store (not in v1)

v1 ships as a release zip for "Load unpacked". Publishing to the Chrome Web Store is planned;
`.github/workflows/chrome-web-store.yml` is a disabled stub.

To enable it later:

1. Register a Chrome Web Store developer account and create the item by uploading a release zip
   once by hand (listing, screenshots from `docs/screenshots/`, privacy practices: the
   [privacy policy](privacy.md) maps to "no data collected").
2. Create OAuth credentials for the Chrome Web Store API and store `CWS_CLIENT_ID`,
   `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` and `CWS_EXTENSION_ID` as repository secrets, scoped
   to a `chrome-web-store` environment with required reviewers.
3. Replace the stub job with an upload + publish step that takes the zip attached to the release
   (never a fresh build), runs on `release: published` or manual dispatch, and remove `if: false`.
4. Justify each permission in the listing exactly as in the privacy policy's permission table.

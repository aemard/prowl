/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the GitHub REST/GraphQL API (no trailing slash). */
  readonly VITE_GITHUB_API_URL: string;
  /** Base URL of the GitHub web host, used for the OAuth device flow and PR links. */
  readonly VITE_GITHUB_WEB_URL: string;
  /** OAuth App client ID baked in at build time. Empty when not configured. */
  readonly VITE_GITHUB_CLIENT_ID: string;
  /** `production`, `development` or `e2e`. */
  readonly VITE_BUILD_MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

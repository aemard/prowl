/** Build-time configuration, injected by `define` in vite.config.ts and vitest.config.ts. */
export const env = {
  /** GitHub REST/GraphQL API base URL, without a trailing slash. */
  apiUrl: import.meta.env.VITE_GITHUB_API_URL,
  /** GitHub web base URL (device flow endpoints and PR links). */
  webUrl: import.meta.env.VITE_GITHUB_WEB_URL,
  /** OAuth App client ID; empty when the build has none configured. */
  clientId: import.meta.env.VITE_GITHUB_CLIENT_ID,
  mode: import.meta.env.VITE_BUILD_MODE,
} as const;

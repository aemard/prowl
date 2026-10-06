export const REPO = 'https://github.com/aemard/prowl';
export const INSTALL = `${REPO}/releases/latest`;
// ponytail: the repository's docs folder until US-025 adds the guides to the site.
export const DOCS = `${REPO}/tree/main/docs`;

/** Absolute path under the site's base (`/prowl/`). `path` has no leading slash. */
export const page = (path = '') => `${import.meta.env.BASE_URL}${path}`;

export const REPO = 'https://github.com/aemard/prowl';
export const INSTALL = `${REPO}/releases/latest`;

/** Absolute path under the site's base (`/prowl/`). `path` has no leading slash. */
export const page = (path = '') => `${import.meta.env.BASE_URL}${path}`;

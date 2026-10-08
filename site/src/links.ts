export const REPO = 'https://github.com/aemard/prowl';
export const STORE =
  'https://chromewebstore.google.com/detail/prowl/homnofbclfgoailffidcbgekohciglcf';
export const RELEASES = `${REPO}/releases/latest`;

/** Absolute path under the site's base (`/prowl/`). `path` has no leading slash. */
export const page = (path = '') => `${import.meta.env.BASE_URL}${path}`;

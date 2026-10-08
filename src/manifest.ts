import pkg from '../package.json' with { type: 'json' };
import { OPEN_PANEL_COMMAND } from './lib/model';

export type BuildMode = 'production' | 'development' | 'e2e';

/** Port of the end-to-end mock GitHub server. Override with PROWL_E2E_PORT to run suites side by side. */
export const E2E_PORT = Number(process.env.PROWL_E2E_PORT ?? 4010);

/** Origin used by the end-to-end mock GitHub server. Only allowed in `e2e` builds. */
export const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;

/** Chrome extension versions must be 1-4 dot-separated integers. */
export function toExtensionVersion(version: string): string {
  const core = version.replace(/[-+].*$/, '');
  if (!/^\d+(\.\d+){0,3}$/.test(core)) {
    throw new Error(`Invalid extension version: ${version}`);
  }
  return core;
}

export function createManifest(mode: BuildMode): chrome.runtime.ManifestV3 {
  const e2e = mode === 'e2e';
  const apiOrigins = e2e ? [E2E_ORIGIN] : ['https://api.github.com'];
  const connectSrc = e2e
    ? `'self' ${E2E_ORIGIN}`
    : "'self' https://api.github.com https://github.com";
  const imgSrc = e2e
    ? `'self' data: ${E2E_ORIGIN} https://avatars.githubusercontent.com`
    : "'self' data: https://avatars.githubusercontent.com";

  const icons = {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  };

  return {
    manifest_version: 3,
    name: e2e ? 'Prowl (e2e)' : 'Prowl',
    short_name: 'Prowl',
    description: 'Follow your GitHub pull requests at a glance, right in the browser side panel.',
    version: toExtensionVersion(pkg.version),
    minimum_chrome_version: '116',
    icons,
    action: {
      default_title: 'Prowl',
      default_icon: icons,
    },
    side_panel: {
      default_path: 'sidepanel/index.html',
    },
    // A keyboard shortcut, handled in src/background/register.ts. Adds no permission.
    commands: {
      [OPEN_PANEL_COMMAND]: {
        suggested_key: { default: 'Ctrl+Shift+P', mac: 'Command+Shift+P' },
        description: 'Open Prowl',
      },
    },
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
    permissions: ['sidePanel', 'storage', 'alarms', 'notifications'],
    host_permissions: apiOrigins.map((origin) => `${origin}/*`),
    // github.com is only needed for the OAuth device flow; it is requested at runtime.
    optional_host_permissions: e2e ? [] : ['https://github.com/*'],
    content_security_policy: {
      extension_pages: [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        `img-src ${imgSrc}`,
        `connect-src ${connectSrc}`,
        "object-src 'none'",
        "base-uri 'none'",
      ].join('; '),
    },
  };
}

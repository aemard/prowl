import { describe, expect, it } from 'vitest';
import { createManifest, E2E_ORIGIN, toExtensionVersion } from './manifest';

describe('toExtensionVersion', () => {
  it('strips pre-release and build metadata', () => {
    expect(toExtensionVersion('1.2.3')).toBe('1.2.3');
    expect(toExtensionVersion('1.2.3-beta.1')).toBe('1.2.3');
    expect(toExtensionVersion('1.2.3+sha.abc')).toBe('1.2.3');
  });

  it('rejects versions Chrome cannot parse', () => {
    expect(() => toExtensionVersion('v1.2')).toThrow(/Invalid extension version/);
    expect(() => toExtensionVersion('')).toThrow(/Invalid extension version/);
  });
});

describe('createManifest', () => {
  it('requests only GitHub API access in production', () => {
    const manifest = createManifest('production');
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.host_permissions).toEqual(['https://api.github.com/*']);
    expect(manifest.optional_host_permissions).toEqual(['https://github.com/*']);
    expect(manifest.permissions).toEqual(['sidePanel', 'storage', 'alarms', 'notifications']);
    expect(manifest.content_security_policy?.extension_pages).toContain("script-src 'self'");
    expect(manifest.content_security_policy?.extension_pages).not.toContain(E2E_ORIGIN);
  });

  it('targets the mock server in e2e builds', () => {
    const manifest = createManifest('e2e');
    expect(manifest.name).toBe('Prowl (e2e)');
    expect(manifest.host_permissions).toEqual([`${E2E_ORIGIN}/*`]);
    expect(manifest.optional_host_permissions).toEqual([]);
    expect(manifest.content_security_policy?.extension_pages).toContain(E2E_ORIGIN);
  });

  it('exposes no surface to web pages or other extensions', () => {
    for (const mode of ['production', 'e2e'] as const) {
      const manifest = createManifest(mode) as Record<string, unknown>;
      expect(manifest.content_scripts).toBeUndefined();
      expect(manifest.externally_connectable).toBeUndefined();
      expect(manifest.web_accessible_resources).toBeUndefined();
      const csp = (manifest.content_security_policy as { extension_pages: string }).extension_pages;
      expect(csp).toMatch(/script-src 'self'(;|$)/);
      expect(csp).toContain("object-src 'none'");
      expect(csp).not.toMatch(/unsafe-(inline|eval)/);
    }
  });
});

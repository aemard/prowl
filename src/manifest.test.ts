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
  it('declares the open-panel shortcut and no other command', () => {
    expect(createManifest('production').commands).toEqual({
      'open-panel': {
        suggested_key: { default: 'Ctrl+Shift+P', mac: 'Command+Shift+P' },
        description: 'Open Prowl',
      },
    });
  });

  it('has a strict extension CSP in production', () => {
    const manifest = createManifest('production');
    expect(manifest.manifest_version).toBe(3);
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

  // What the manifest may ask Chrome for (permissions, hosts, content scripts, web-accessible
  // resources, ...) is locked in tests/unit/siteAccess.test.ts.
  it('allows no unsafe script source or plugin', () => {
    for (const mode of ['production', 'e2e'] as const) {
      const csp = createManifest(mode).content_security_policy?.extension_pages ?? '';
      expect(csp).toMatch(/script-src 'self'(;|$)/);
      expect(csp).toContain("object-src 'none'");
      expect(csp).not.toMatch(/unsafe-(inline|eval)/);
    }
  });
});

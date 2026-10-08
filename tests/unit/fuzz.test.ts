/**
 * Property-based fuzzing of the trust boundaries: text from GitHub, values from storage and sync,
 * and URLs from data. Each property runs on a few hundred generated inputs.
 */
import fc from 'fast-check';
import { expect, it } from 'vitest';
import { createGitHubClient } from '../../src/lib/github/client';
import { GitHubError } from '../../src/lib/github/errors';
import { normalizeSettings } from '../../src/lib/storage/settings';
import { isGitHubUrl } from '../../src/lib/url';

/** The characters a token may hold (`TOKEN_SHAPE` in pat.ts). */
const token = fc.stringMatching(/^[A-Za-z0-9_]{4,60}$/);

it('never lets the token through in an error built from GitHub text', async () => {
  await fc.assert(
    fc.asyncProperty(
      token,
      fc.array(fc.string()),
      fc.integer({ min: 400, max: 599 }),
      async (secret, parts, status) => {
        const message = parts.join(secret);
        const client = createGitHubClient({
          token: secret,
          apiUrl: 'https://api.github.com',
          fetch: async () => new Response(JSON.stringify({ message }), { status }),
        });
        const error = await client.rest('GET', '/user').then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(GitHubError);
        expect((error as GitHubError).message).not.toContain(secret);
      },
    ),
  );
});

it('repairs any stored or synced value into settings that stay as they are', () => {
  fc.assert(
    fc.property(fc.anything(), (value) => {
      const settings = normalizeSettings(value);
      expect(normalizeSettings(structuredClone(settings))).toEqual(settings);
    }),
  );
});

it('only accepts URLs whose host is GitHub', () => {
  const lookalike = fc.oneof(
    fc.string(),
    fc.constantFrom('.evil.test', '@evil.test', ':443@evil.test', '%2eevil.test', '\\@evil.test'),
  );
  fc.assert(
    fc.property(lookalike, fc.string(), (suffix, rest) => {
      const url = `https://github.com${suffix}${rest}`;
      if (isGitHubUrl(url)) expect(new URL(url).hostname).toBe('github.com');
    }),
  );
});

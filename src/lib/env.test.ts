import { describe, expect, it } from 'vitest';
import { env } from './env';

describe('env', () => {
  it('exposes build-time configuration', () => {
    expect(env.apiUrl).toBe('https://api.github.com');
    expect(env.webUrl).toBe('https://github.com');
    expect(env.clientId).toBe('test-client-id');
    expect(env.mode).toBe('test');
  });
});

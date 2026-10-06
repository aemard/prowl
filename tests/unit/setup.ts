import { cleanup } from '@testing-library/preact';
import { afterEach, beforeEach } from 'vitest';
import { installFakeChrome } from '../../src/test/chrome';

beforeEach(() => {
  installFakeChrome();
});

afterEach(() => {
  cleanup();
});

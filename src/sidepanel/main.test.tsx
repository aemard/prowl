import { expect, it, vi } from 'vitest';

const startup = vi.hoisted(() => ({ imported: false, rendered: false }));
const language = vi.hoisted(() => {
  let resolve: (value: 'en') => void = () => {};
  const promise = new Promise<'en'>((done) => {
    resolve = done;
  });
  return { promise, resolve };
});

vi.mock('../lib/storage/language', () => ({ loadLanguage: () => language.promise }));
vi.mock('./App', () => {
  startup.imported = true;
  return {
    App: () => {
      startup.rendered = true;
      return null;
    },
  };
});

it('loads the list code before the language read finishes, while keeping a loading screen', async () => {
  const root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
  await import('./main');
  expect(startup.imported).toBe(true);
  expect(startup.rendered).toBe(false);
  expect(root.querySelector('[aria-busy="true"]')).toBeTruthy();

  language.resolve('en');
  await vi.waitFor(() => expect(startup.rendered).toBe(true));
});

import { render } from 'preact';
import { messageLocale } from '../lib/i18n';
import { loadLanguage } from '../lib/storage/language';
import { subscribeSettings } from '../lib/storage/settings';
import { hydrateStore } from './state/store';
import '../styles/tokens.css';
import '../styles/base.css';

async function start(root: HTMLElement) {
  const initialLanguage = loadLanguage();
  // Reopen the current route so module-level labels also use the selected catalog.
  // Subscribe before loading completes, so an opening panel cannot miss a newer choice.
  subscribeSettings((next) => {
    void initialLanguage.then((language) => {
      if (next.language !== language) window.location.reload();
    });
  });
  await initialLanguage;
  const { App } = await import('./App');
  document.documentElement.lang = messageLocale();
  // Start reading storage before the first render; the skeleton shows until it lands.
  void hydrateStore();
  render(<App />, root);
}

const root = document.getElementById('app');
if (root) void start(root);

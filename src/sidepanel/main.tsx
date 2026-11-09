import { render } from 'preact';
import { messageLocale } from '../lib/i18n';
import { loadLanguage } from '../lib/storage/language';
import { subscribeSettings } from '../lib/storage/settings';
// Keep the list and its styles in the initial module graph, before the page finishes loading.
import { App } from './App';
import { Loading } from './components/Loading';
import { hydrateStore } from './state/store';
import '../styles/tokens.css';
import '../styles/base.css';

async function start(root: HTMLElement) {
  const initialLanguage = loadLanguage();
  // Reopen the current route when the language preference changes.
  // Subscribe before loading completes, so an opening panel cannot miss a newer choice.
  subscribeSettings((next) => {
    void initialLanguage.then((language) => {
      if (next.language !== language) window.location.reload();
    });
  });
  await initialLanguage;
  document.documentElement.lang = messageLocale();
  // Start reading storage before the first render; the skeleton shows until it lands.
  void hydrateStore();
  render(<App />, root);
}

const root = document.getElementById('app');
if (root) {
  document.documentElement.lang = messageLocale();
  render(<Loading />, root);
  void start(root);
}

import { render } from 'preact';
import { messageLocale } from '../lib/i18n';
import { App } from './App';
import { hydrateStore } from './state/store';
import '../styles/tokens.css';
import '../styles/base.css';

document.documentElement.lang = messageLocale();
const root = document.getElementById('app');
if (root) {
  // Start reading storage before the first render; the skeleton shows until it lands.
  void hydrateStore();
  render(<App />, root);
}

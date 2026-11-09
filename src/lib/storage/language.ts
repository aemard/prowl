import { setLanguage } from '../i18n';
import { loadSettings } from './settings';

/** Restore the preference before rendering or producing background messages. */
export async function loadLanguage() {
  const { language } = await loadSettings();
  await setLanguage(language);
  return language;
}

import { substituteMessage } from '../lib/i18n';

type Catalog = Record<string, { message: string }>;
const catalogs = import.meta.glob<Catalog>('../../public/_locales/*/messages.json', {
  eager: true,
  import: 'default',
});

function catalogMessage(locale: string, key: string, values: string[]): string {
  const normalized = locale.replaceAll('-', '_');
  for (const code of [normalized, normalized.split('_')[0], 'en']) {
    const entry = catalogs[`../../public/_locales/${code}/messages.json`]?.[key];
    if (entry) return substituteMessage(entry.message, values);
  }
  return '';
}

/** Native-like catalog lookup, with a mutable test language and English fallback. */
export function fakeI18n(language: () => string) {
  return {
    getUILanguage: language,
    getMessage: (key: string, substitutions?: string | string[]): string =>
      catalogMessage(
        language(),
        key,
        typeof substitutions === 'string' ? [substitutions] : (substitutions ?? []),
      ),
  };
}

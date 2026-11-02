import english from '../../public/_locales/en/messages.json';
import type { Language } from './model';
import { isRecord } from './storage/guards';

export type MessageKey = keyof typeof english;
type Substitution = string | number;
type Catalog = Partial<Record<MessageKey, { message: string }>>;

let language: Language = 'system';
let catalog: Catalog = english;
let pending: Promise<void> | undefined;
let revision = 0;

/** Read only packaged catalogs: Chrome's message API cannot select an explicit language. */
export function setLanguage(next: Language): Promise<void> {
  if (next === language && pending) return pending;
  language = next;
  catalog = english;
  const current = ++revision;
  pending = (async () => {
    if (next === 'system' || next === 'en') return;
    try {
      const response = await fetch(
        chrome.runtime.getURL(`_locales/${next.replace('-', '_')}/messages.json`),
      );
      if (!response.ok) return;
      const messages: unknown = await response.json();
      if (current === revision && isRecord(messages)) catalog = messages as Catalog;
    } catch {
      // English stays usable if a packaged catalog cannot be read.
    }
  })();
  return pending;
}

/** Formats follow the explicit choice, or Chrome's interface language in automatic mode. */
export function uiLocale(): string {
  return language === 'system' ? globalThis.chrome?.i18n?.getUILanguage() || 'en' : language;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(uiLocale()).format(value);
}

/** Also used by the Chrome fake; replacements never interpret HTML or replacement patterns. */
export function substituteMessage(message: string, values: readonly string[]): string {
  return message.replace(/\$P([1-9])\$/gi, (_, index: string) => values[Number(index) - 1] ?? '');
}

export function t(key: MessageKey, ...values: Substitution[]): string {
  const message = catalog[key]?.message;
  const substitutions = values.map((value) =>
    typeof value === 'number' ? formatNumber(value) : value,
  );
  return (
    (language === 'system'
      ? globalThis.chrome?.i18n?.getMessage(key, substitutions)
      : substituteMessage(
          typeof message === 'string' && message ? message : english[key].message,
          substitutions,
        )) || substituteMessage(english[key].message, substitutions)
  );
}

/** The catalog can fall back to English even when the browser uses another language. */
export function messageLocale(): string {
  return t('languageTag');
}

/** Plural rules follow the text language, including English fallback and CJK's other form. */
export function countMessage(
  count: number,
  one: MessageKey,
  other: MessageKey,
  ...values: Substitution[]
): string {
  return t(
    new Intl.PluralRules(messageLocale()).select(count) === 'one' ? one : other,
    count,
    ...values,
  );
}

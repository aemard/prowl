import english from '../../public/_locales/en/messages.json';

export type MessageKey = keyof typeof english;
type Substitution = string | number;

/** Chrome selects the catalog and supplies its built-in English fallback. */
export function uiLocale(): string {
  return globalThis.chrome?.i18n?.getUILanguage() || 'en';
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(uiLocale()).format(value);
}

/** Also used by the Chrome fake; replacements never interpret HTML or replacement patterns. */
export function substituteMessage(message: string, values: readonly string[]): string {
  return message.replace(/\$P([1-9])\$/gi, (_, index: string) => values[Number(index) - 1] ?? '');
}

export function t(key: MessageKey, ...values: Substitution[]): string {
  const substitutions = values.map((value) =>
    typeof value === 'number' ? formatNumber(value) : value,
  );
  return (
    globalThis.chrome?.i18n?.getMessage(key, substitutions) ||
    substituteMessage(english[key].message, substitutions)
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

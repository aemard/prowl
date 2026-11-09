import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import english from '../../public/_locales/en/messages.json';
import { fakeChrome } from '../test/chrome';
import { countMessage, formatNumber, messageLocale, t, uiLocale } from './i18n';
import { sectionLabel } from './sectionLabel';
import { formatRelativeTime } from './time/relative';

const locales = ['en', 'ja', 'zh_CN', 'zh_TW', 'fr', 'de', 'es'] as const;
type Message = { message: string; placeholders?: Record<string, { content: string }> };
const root = resolve(import.meta.dirname, '../../public/_locales');

describe('shipped message catalogs', () => {
  it.each(locales)('%s has complete translations and compatible placeholders', (locale) => {
    const messages: Record<string, Message> = JSON.parse(
      readFileSync(resolve(root, locale, 'messages.json'), 'utf8'),
    );
    const names = Object.keys(messages).map((key) => key.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(messages).sort()).toEqual(Object.keys(english).sort());
    for (const [key, entry] of Object.entries(messages)) {
      expect(entry.message.trim(), `${locale}.${key}`).not.toBe('');
      expect(entry.placeholders, `${locale}.${key}`).toEqual(
        (english[key as keyof typeof english] as Message).placeholders,
      );
      const slots = (message: string) => [...message.matchAll(/\$P\d\$/g)].map(([s]) => s).sort();
      expect(slots(entry.message), `${locale}.${key}`).toEqual(
        slots(english[key as keyof typeof english].message),
      );
    }
    expect(messages.extensionName?.message.length).toBeLessThanOrEqual(75);
    expect(messages.extensionDescription?.message.length).toBeLessThanOrEqual(132);
    expect(messages.addToList?.message.toLowerCase()).toContain(
      messages.add?.message.toLowerCase(),
    );
  });
});

describe('Chrome internationalization', () => {
  it('keeps the offline title countdown distinct from its network error detail', () => {
    expect(t('offlineRetryTitle', t('retryingInMin', 3))).toBe(
      'Could not reach GitHub — retrying in 3 min',
    );
    expect(t('couldNotReachGithub')).toBe('Could not reach GitHub.');
    expect(chrome.i18n.getMessage('OFFLINERETRYTITLE', ['retrying soon'])).toBe(
      'Could not reach GitHub — retrying soon',
    );
  });

  it.each([
    ['ja', '設定', '3 分前'],
    ['zh-CN', '设置', '3 分钟前'],
    ['zh-TW', '設定', '3 分鐘前'],
    ['fr', 'Paramètres', 'il y a 3 min'],
    ['de', 'Einstellungen', 'vor 3 Min.'],
    ['es', 'Ajustes', 'hace 3 min'],
  ])('uses the %s catalog, substitutions and relative time', (locale, settings, relative) => {
    fakeChrome().__state.locale = locale;
    expect(t('settings')).toBe(settings);
    expect(formatRelativeTime(0, 180_000)).toBe(relative);
    expect(t('copied', '<script>$P1$</script>')).toContain('<script>$P1$</script>');
  });

  it('uses the parent locale for a regional variant and English for unsupported languages', () => {
    fakeChrome().__state.locale = 'fr-CA';
    expect(t('settings')).toBe('Paramètres');
    fakeChrome().__state.locale = 'it';
    expect(t('settings')).toBe('Settings');
    expect(messageLocale()).toBe('en');
    fakeChrome().__state.locale = 'ru';
    expect(countMessage(21, 'pullCountOne', 'pullCountOther')).toBe('21 pull requests');
  });

  it('falls back to English if Chrome returns an empty message or i18n is unavailable', () => {
    vi.spyOn(fakeChrome().i18n, 'getMessage').mockReturnValue('');
    expect(t('copied', '$1 $&')).toBe('Copied $1 $&');
    vi.stubGlobal('chrome', undefined);
    expect(uiLocale()).toBe('en');
    expect(t('settings')).toBe('Settings');
    expect(t('copied', 'main')).toBe('Copied main');
  });

  it('formats numbers and plurals according to the browser language', () => {
    fakeChrome().__state.locale = 'de';
    expect(formatNumber(5000)).toBe('5.000');
    expect(countMessage(1, 'pullCountOne', 'pullCountOther')).toBe('1 Pull Request');
    expect(countMessage(2, 'pullCountOne', 'pullCountOther')).toBe('2 Pull Requests');
    fakeChrome().__state.locale = 'ja';
    expect(countMessage(1, 'pullCountOne', 'pullCountOther')).toBe('1 件の PR');
    expect(countMessage(2, 'pullCountOne', 'pullCountOther')).toBe('2 件の PR');
  });

  it('translates built-in section labels without rewriting user names', () => {
    fakeChrome().__state.locale = 'de';
    expect(
      sectionLabel({ id: 'authored', kind: 'authored', label: 'Created by me', enabled: true }),
    ).toBe('Von mir erstellt');
    expect(
      sectionLabel({
        id: 'custom-1',
        kind: 'custom',
        label: 'My label',
        query: 'label:bug',
        enabled: true,
      }),
    ).toBe('My label');
  });
});

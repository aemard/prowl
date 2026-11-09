import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prEvent } from '../../tests/fixtures/events';
import { notifyEvents } from '../background/notifier';
import { fakeChrome } from '../test/chrome';
import { countMessage, formatNumber, messageLocale, setLanguage, t, uiLocale } from './i18n';
import type { Language } from './model';
import { loadLanguage } from './storage/language';
import { emptyPrLocal } from './storage/prLocal';
import { defaultSettings } from './storage/settings';
import { formatRelativeTime } from './time/relative';

const catalog = (code: string) =>
  readFileSync(resolve(import.meta.dirname, `../../public/_locales/${code}/messages.json`), 'utf8');

beforeEach(async () => {
  await setLanguage('system');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const code = new URL(url).pathname.split('/')[2] ?? 'en';
      return new Response(catalog(code));
    }),
  );
});
afterEach(() => setLanguage('system'));

describe('manual language preference', () => {
  it.each<Language>(['en', 'ja', 'zh-CN', 'zh-TW', 'fr', 'de', 'es'])(
    'loads %s independently of Chrome and preserves literal substitutions',
    async (language) => {
      fakeChrome().__state.locale = 'it';
      await setLanguage(language);
      const messages = JSON.parse(catalog(language.replace('-', '_')));
      expect(t('settings')).toBe(messages.settings.message);
      expect(messageLocale()).toBe(messages.languageTag.message);
      expect(uiLocale()).toBe(language);
      expect(t('copied', '$1 <b>$P1$</b>')).toContain('$1 <b>$P1$</b>');
    },
  );

  it('uses the chosen locale for numbers, relative dates and plural rules', async () => {
    fakeChrome().__state.locale = 'en';
    await setLanguage('de');
    expect(formatNumber(5000)).toBe('5.000');
    expect(formatRelativeTime(0, 180_000)).toBe('vor 3 Min.');
    await setLanguage('ja');
    expect(countMessage(1, 'pullCountOne', 'pullCountOther')).toBe('1 件の PR');
    expect(countMessage(2, 'pullCountOne', 'pullCountOther')).toBe('2 件の PR');
  });

  it('shares an in-flight load and does not refetch an unchanged choice', async () => {
    await Promise.all([setLanguage('fr'), setLanguage('fr')]);
    await setLanguage('fr');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(chrome.runtime.getURL('_locales/fr/messages.json'));
  });

  it('restores Chrome selection and lets English override a translated browser', async () => {
    fakeChrome().__state.locale = 'fr';
    await setLanguage('en');
    expect(t('settings')).toBe('Settings');
    expect(messageLocale()).toBe('en');
    await setLanguage('system');
    expect(t('settings')).toBe('Paramètres');
    expect(uiLocale()).toBe('fr');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['network', 'status', 'json', 'missing', 'null', 'invalidMessage'])(
    'falls back to English for a %s failure',
    async (failure) => {
      vi.mocked(fetch).mockImplementationOnce(async () => {
        if (failure === 'network') throw new Error('unavailable');
        if (failure === 'status') return new Response('', { status: 404 });
        if (failure === 'json') return new Response('invalid JSON');
        if (failure === 'null') return Response.json(null);
        if (failure === 'invalidMessage') return Response.json({ settings: { message: 42 } });
        return Response.json({});
      });
      fakeChrome().__state.locale = 'de';
      await setLanguage('ja');
      expect(t('settings')).toBe('Settings');
      expect(messageLocale()).toBe('en');
      expect(t('copied', 'feature/$1')).toBe('Copied feature/$1');
    },
  );

  it('ignores a slow catalog response after another choice becomes current', async () => {
    let finish: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const earlier = setLanguage('ja');
    await setLanguage('fr');
    finish(new Response(catalog('ja')));
    await earlier;
    expect(uiLocale()).toBe('fr');
    expect(t('settings')).toBe('Paramètres');
  });

  it('restores a persisted choice after startup and repairs invalid values', async () => {
    await chrome.storage.local.set({ settings: { ...defaultSettings(), language: 'fr' } });
    expect(await loadLanguage()).toBe('fr');
    expect(t('settings')).toBe('Paramètres');
    await chrome.storage.local.set({ settings: { language: '../fr' } });
    expect(await loadLanguage()).toBe('system');
    expect(t('settings')).toBe('Settings');
  });

  it('translates notification text and buttons even when the worker modules were imported first', async () => {
    await setLanguage('ja');
    const event = prEvent({ type: 'ci_failed' });
    await notifyEvents(
      [event],
      { ...defaultSettings().notifications, enabled: true },
      emptyPrLocal(),
    );
    expect(fakeChrome().__state.notifications.get(event.id)?.options).toMatchObject({
      title: t('ciFailed'),
      buttons: [{ title: t('open') }, { title: t('snooze1H') }],
    });
  });
});

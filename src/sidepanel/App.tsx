import { useSignalEffect } from '@preact/signals';
import type { ComponentType } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../lib/i18n';
import type { Theme } from '../lib/model';
import { Header } from './components/Header';
import { Loading } from './components/Loading';
import { lazy } from './components/lazy';
import { RefreshAnnouncer, ShortcutsDialog, useShortcuts } from './components/Shortcuts';
import { StatusBanner } from './components/StatusBanner';
import { ToastRegion } from './components/ui/Toast';
import { type Route, route } from './state/router';
import { hydrated, settings } from './state/store';
import { ListView } from './views/List';
import { OnboardingView } from './views/Onboarding';
import './App.css';

/** Settings is rarely opened: its own chunk, loaded on first visit. */
const SettingsView = lazy(() => import('./views/Settings').then((m) => m.SettingsView));

const VIEWS: Record<Route, ComponentType> = {
  list: ListView,
  settings: SettingsView,
  onboarding: OnboardingView,
};

/** Accessible name of the main landmark, announced when focus moves there on navigation. */
const LABELS: Record<Route, string> = {
  list: t('pullRequests'),
  settings: t('settings'),
  onboarding: t('signIn'),
};

/** `system` removes the override so tokens.css follows `prefers-color-scheme`. */
function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function Shell() {
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const current = route.value;
  const View = VIEWS[current];

  // Move focus into the new view when the route changes (not on first load), so keyboard and
  // screen reader users land on what they just opened.
  useEffect(() => {
    if (firstRender.current) firstRender.current = false;
    else mainRef.current?.focus();
  }, [current]);

  useShortcuts(current === 'list');

  return (
    <>
      <Header />
      <main ref={mainRef} class="app-main" tabIndex={-1} aria-label={LABELS[current]}>
        {current !== 'onboarding' && current !== 'list' && <StatusBanner />}
        <View />
      </main>
      <ShortcutsDialog />
      <RefreshAnnouncer />
    </>
  );
}

/** The panel shell: skeleton until the store is hydrated, then header plus the current view. */
export function App() {
  useSignalEffect(() => applyTheme(settings.value.theme));
  return (
    <>
      {hydrated.value ? (
        <Shell />
      ) : (
        <>
          <Header />
          <Loading />
        </>
      )}
      <ToastRegion />
    </>
  );
}

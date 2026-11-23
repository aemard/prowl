import type { ComponentType, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { Button } from './ui/Button';

/**
 * A component loaded on first use, as its own chunk, so the side panel's first render only pays
 * for the list. `fallback` renders until the chunk arrived (immediately on later uses). A chunk
 * that fails to load (an extension updated under an open panel) shows "Could not load" and a
 * Try again button instead of a fallback that never ends.
 */
export function lazy<P extends object>(
  load: () => Promise<ComponentType<P>>,
  fallback: (props: P) => JSX.Element | null = () => null,
): ComponentType<P> {
  let loaded: ComponentType<P> | undefined;
  let pending: Promise<ComponentType<P>> | undefined;
  return function Lazy(props: P) {
    const [Component, setComponent] = useState(() => loaded);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      if (Component || failed) return;
      pending ??= load().then((component) => {
        loaded = component;
        return component;
      });
      let live = true;
      pending.then(
        (component) => live && setComponent(() => component),
        () => {
          pending = undefined;
          if (live) setFailed(true);
        },
      );
      return () => {
        live = false;
      };
    }, [Component, failed]);
    if (Component) return <Component {...props} />;
    if (!failed) return fallback(props);
    return (
      <p role="alert">
        {t('couldNotLoad')}{' '}
        <Button size="sm" onClick={() => setFailed(false)}>
          {t('tryAgain')}
        </Button>
      </p>
    );
  };
}

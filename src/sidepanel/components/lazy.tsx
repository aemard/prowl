import type { ComponentType, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

/**
 * A component loaded on first use, as its own chunk, so the side panel's first render only pays
 * for the list. `fallback` renders until the chunk arrived (immediately on later uses).
 * ponytail: no error boundary; a failed chunk load leaves the fallback (extension files are local).
 */
export function lazy<P extends object>(
  load: () => Promise<ComponentType<P>>,
  fallback: (props: P) => JSX.Element | null = () => null,
): ComponentType<P> {
  let loaded: ComponentType<P> | undefined;
  let pending: Promise<ComponentType<P>> | undefined;
  return function Lazy(props: P) {
    const [Component, setComponent] = useState(() => loaded);
    useEffect(() => {
      if (Component) return;
      pending ??= load().then((component) => {
        loaded = component;
        return component;
      });
      let live = true;
      void pending.then((component) => live && setComponent(() => component));
      return () => {
        live = false;
      };
    }, [Component]);
    return Component ? <Component {...props} /> : fallback(props);
  };
}

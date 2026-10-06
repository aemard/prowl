import { useEffect, useState } from 'preact/hooks';

/**
 * The current time in ms, refreshed every `ms`. Relative times derived from it keep up with the
 * clock; pass it down as a prop, since a child that reads no changed signal or prop is skipped.
 */
export function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

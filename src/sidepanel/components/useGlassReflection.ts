import { useEffect } from 'preact/hooks';

/** One passive listener and at most one paint per frame, regardless of the number of cards. */
export function useGlassReflection(): void {
  useEffect(() => {
    const reduced = matchMedia(
      '(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce), (hover: none), (pointer: coarse)',
    );
    let surface: HTMLElement | null = null;
    let frame = 0;
    let x = 0;
    let y = 0;
    const clear = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      for (const name of ['--light-x', '--light-y', '--light-strength'])
        surface?.style.removeProperty(name);
      surface = null;
    };
    const paint = () => {
      frame = 0;
      if (!surface?.isConnected) return clear();
      const box = surface.getBoundingClientRect();
      surface.style.setProperty('--light-x', `${(100 * (x - box.left)) / box.width}%`);
      surface.style.setProperty('--light-y', `${(100 * (y - box.top)) / box.height}%`);
      surface.style.setProperty('--light-strength', '.3');
    };
    const move = (event: PointerEvent) => {
      if (reduced.matches || event.pointerType === 'touch') return;
      const target = event.target instanceof Element ? event.target : null;
      const next = target?.closest('.ui-menu, dialog')
        ? null
        : (target?.closest<HTMLElement>('.pr-card, .header, .list__filter, .section-tabs') ?? null);
      if (next !== surface) clear();
      surface = next;
      x = event.clientX;
      y = event.clientY;
      if (surface && !frame) frame = requestAnimationFrame(paint);
    };
    const leave = (event: PointerEvent) => {
      if (!event.relatedTarget) clear();
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerout', leave);
    document.addEventListener('scroll', clear, true);
    reduced.addEventListener('change', clear);
    return () => {
      clear();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('scroll', clear, true);
      reduced.removeEventListener('change', clear);
    };
  }, []);
}

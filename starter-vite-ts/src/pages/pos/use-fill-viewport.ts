import { useState, useLayoutEffect } from 'react';

// ----------------------------------------------------------------------

/**
 * The height that takes an element from where it starts to the bottom of the window, so the
 * register fits one screen and its pay buttons are never below the fold. Whatever sits above it
 * (the header, a banner) and the padding its parents keep below it are measured rather than
 * assumed: the web POS and the till on the branch PC wrap this page differently.
 *
 * Returns the ref to put on the element and the height to give it (undefined while off).
 */
export function useFillViewport<T extends HTMLElement>(enabled: boolean, minHeight = 440) {
  const [el, setEl] = useState<T | null>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    if (!enabled || !el) {
      setHeight(undefined);
      return undefined;
    }

    const measure = () => {
      // Hidden (no shift open): nothing to measure until it shows.
      if (!el.offsetParent) return;
      let below = 0;
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        below += parseFloat(getComputedStyle(p).paddingBottom) || 0;
      }
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(minHeight, Math.floor(window.innerHeight - top - below)));
    };

    measure();
    // A banner opening or closing above changes the parent's height, and so where this starts.
    const observer = new ResizeObserver(measure);
    if (el.parentElement) observer.observe(el.parentElement);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [enabled, el, minHeight]);

  return [setEl, height] as const;
}

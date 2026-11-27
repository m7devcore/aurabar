import { useLayoutEffect, type RefObject } from 'react';

// Smallest icon scale before the dock gives up shrinking and lets the app strip scroll
const MIN_FIT = 0.74;

/**
 * Keeps the dock from overflowing its row when many apps are open, instead of letting the right
 * tray spill over the app icons.
 *
 * It shrinks the app icons and their gaps first (scale var `--dock-fit`), then narrows the
 * inline music pill (`data-tight`), and only when even that is not enough lets the strip scroll
 * (`data-scroll`). Everything is written straight to the bar's attributes, so React re-renders
 * never fight it and a resize costs no render. The CSS lives next to `.dock-bar` in app.css.
 */
export function useDockFit(
  barRef: RefObject<HTMLDivElement | null>,
  stripRef: RefObject<HTMLDivElement | null>,
  deps: readonly unknown[]
): void {
  useLayoutEffect(() => {
    const bar = barRef.current;
    const strip = stripRef.current;
    const host = bar?.parentElement;
    if (!bar || !strip || !host) return;

    const apply = (fit: number) => {
      bar.style.setProperty('--dock-fit', fit.toFixed(3));
      bar.setAttribute('data-fit', '');
    };

    const reset = () => {
      bar.style.removeProperty('--dock-fit');
      bar.style.removeProperty('--dock-strip-max');
      bar.removeAttribute('data-fit');
      bar.removeAttribute('data-tight');
      bar.removeAttribute('data-scroll');
    };

    let lastRoom = Number.NaN;
    let lastChildCount = -1;

    const measure = () => {
      // Mid-drag the strip is padded and re-ordered; the next measure after the drop catches up
      if (strip.classList.contains('is-live-dragging')) return;

      const hostStyle = getComputedStyle(host);
      const barStyle = getComputedStyle(bar);
      const hostWidth =
        host.clientWidth - parseFloat(hostStyle.paddingLeft) - parseFloat(hostStyle.paddingRight);
      const chrome =
        parseFloat(barStyle.paddingLeft) +
        parseFloat(barStyle.paddingRight) +
        parseFloat(barStyle.borderLeftWidth) +
        parseFloat(barStyle.borderRightWidth);
      const gap = parseFloat(barStyle.columnGap) || 0;

      // Width left for the strip once everything else in the row has its natural size
      const roomForStrip = () => {
        let used = chrome;
        let count = 0;
        for (const child of Array.from(bar.children) as HTMLElement[]) {
          if (child === strip || child.offsetWidth === 0) continue;
          used += child.offsetWidth;
          count += 1;
        }
        return hostWidth - used - gap * count;
      };

      const childCount = strip.children.length;
      const isFitted =
        bar.hasAttribute('data-fit') ||
        bar.hasAttribute('data-tight') ||
        bar.hasAttribute('data-scroll');
      const currentRoom = roomForStrip();

      // Fast-path when already unfitted and strip comfortably fits: zero DOM writes
      if (!isFitted && strip.offsetWidth > 0 && strip.offsetWidth <= currentRoom + 0.5) {
        lastRoom = currentRoom;
        lastChildCount = childCount;
        return;
      }

      // Skip full reset+refit flicker on 1px tray jitter (e.g. clock/volume digit width)
      if (
        isFitted &&
        childCount === lastChildCount &&
        Number.isFinite(lastRoom) &&
        Math.abs(currentRoom - lastRoom) < 2
      ) {
        return;
      }

      lastRoom = currentRoom;
      lastChildCount = childCount;

      reset();
      const natural = strip.offsetWidth;
      if (natural <= 0) return;
      if (natural <= roomForStrip() + 0.5) return;

      // Shrink toward `room`; scaled gaps/buttons are not perfectly linear, so verify and refine
      const settle = (): boolean => {
        const room = roomForStrip();
        let fit = Math.max(MIN_FIT, Math.min(1, room / natural));
        for (let i = 0; i < 4; i += 1) {
          apply(fit);
          const width = strip.offsetWidth;
          if (width <= room + 0.5) return true;
          const next = (fit * room) / width;
          if (next < MIN_FIT) break;
          fit = next;
        }
        apply(MIN_FIT);
        return strip.offsetWidth <= room + 0.5;
      };

      if (settle()) return;
      bar.setAttribute('data-tight', '');
      if (settle()) return;
      bar.setAttribute('data-scroll', '');
      bar.style.setProperty('--dock-strip-max', `${Math.max(96, Math.floor(roomForStrip()))}px`);
    };

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };

    measure();

    // Screen/layout size and the non-strip pieces (music pill, tray) changing; not the strip
    // itself, which this hook resizes
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(host);
    for (const child of Array.from(bar.children)) {
      if (child !== strip) resizeObserver.observe(child);
    }
    // Direct children only (apps added/removed): ignore internal badge/dot mutations
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(strip, { childList: true });

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

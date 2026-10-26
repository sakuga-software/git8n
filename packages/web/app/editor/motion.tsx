import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

/**
 * A group of toggle buttons whose selection slides from a button to the next
 * (DB-613). The mark is drawn by `markClassName`. It takes the box of the
 * selected button, and it is hidden while no button is selected.
 */
export function Sliding({
  selected,
  markClassName,
  children,
}: {
  selected: string | null;
  markClassName: string;
  children: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const box = frame.current;
    const line = mark.current;

    if (!box || !line) return;

    const place = () => {
      const button = box.querySelector<HTMLElement>('[data-selected="true"]');

      if (!button) {
        delete line.dataset.placed;
        delete line.dataset.moves;

        return;
      }

      const outer = box.getBoundingClientRect();
      const inner = button.getBoundingClientRect();

      line.style.width = `${inner.width}px`;
      line.style.height = `${inner.height}px`;
      line.style.transform = `translate(${inner.left - outer.left}px, ${inner.top - outer.top}px)`;
      line.dataset.placed = '';
    };

    place();

    // The first place is not a move: the transition starts after the browser drew it.
    const frameId = requestAnimationFrame(() => {
      if (line.dataset.placed !== undefined) line.dataset.moves = '';
    });
    // A count that a read fills changes the width of its button.
    const resize = new ResizeObserver(place);

    resize.observe(box);
    box.querySelectorAll('button').forEach((button) => resize.observe(button));

    return () => {
      cancelAnimationFrame(frameId);
      resize.disconnect();
    };
  }, [selected]);

  return (
    <div ref={frame} className="relative">
      <span ref={mark} aria-hidden="true" className={`slide-mark ${markClassName}`} />
      {children}
    </div>
  );
}

/** The list under the tabs comes in when the tab changes, but not at the first render. */
export function useSwap(target: RefObject<HTMLElement | null>, key: string) {
  const last = useRef(key);

  useEffect(() => {
    if (last.current === key) return;

    last.current = key;

    const still = window.matchMedia(REDUCED).matches;

    target.current?.animate(
      still
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'none' },
          ],
      { duration: still ? 150 : 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
  }, [target, key]);
}

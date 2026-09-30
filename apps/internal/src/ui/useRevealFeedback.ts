import { useEffect, useRef, useState } from "react";

/** Reveals an already available section after an action changes what it shows. */
export function useRevealFeedback<T extends HTMLElement = HTMLElement>() {
  const regionRef = useRef<T>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [highlighted, setHighlighted] = useState(false);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  function reveal() {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setHighlighted(true);
    frameRef.current = window.requestAnimationFrame(() => {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      regionRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      headingRef.current?.focus({ preventScroll: true });
      frameRef.current = null;
    });
    timerRef.current = window.setTimeout(() => {
      setHighlighted(false);
      timerRef.current = null;
    }, 2400);
  }

  function clearHighlight() {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setHighlighted(false);
  }

  return { regionRef, headingRef, highlighted, reveal, clearHighlight };
}

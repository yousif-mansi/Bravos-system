import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Reveals an already available section after an action changes what it shows. */
export function useRevealFeedback<T extends HTMLElement = HTMLElement>() {
  const regionRef = useRef<T>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [highlighted, setHighlighted] = useState(false);
  const [, setRevealNonce] = useState(0);
  const pendingRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!pendingRef.current) return;
    const heading = headingRef.current?.isConnected ? headingRef.current : null;
    const region = regionRef.current?.isConnected ? regionRef.current : null;
    if (!heading && !region) return;
    pendingRef.current = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    region?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    heading?.focus({ preventScroll: true });
  });

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  function reveal() {
    pendingRef.current = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setHighlighted(true);
    setRevealNonce((nonce) => nonce + 1);
    timerRef.current = window.setTimeout(() => {
      setHighlighted(false);
      timerRef.current = null;
    }, 2400);
  }

  function clearHighlight() {
    pendingRef.current = false;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setHighlighted(false);
  }

  return { regionRef, headingRef, highlighted, reveal, clearHighlight };
}

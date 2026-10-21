"use client";

import { useEffect, useRef } from "react";
import styles from "./ambient-scene.module.css";

const spotQuery = "(pointer: fine) and (prefers-reduced-motion: no-preference)";

export function AmbientScene() {
  const spotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const spot = spotRef.current;
    if (!spot) return;
    const media = window.matchMedia(spotQuery);
    let frame = 0;
    let x = 0;
    let y = 0;

    const paint = () => {
      frame = 0;
      spot.style.setProperty("--spot-x", `${x}px`);
      spot.style.setProperty("--spot-y", `${y}px`);
    };

    const onMove = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      spot.hidden = false;
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(paint);
    };

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      frame = 0;
      spot.hidden = true;
    };

    const start = () => {
      window.addEventListener("pointermove", onMove, { passive: true });
    };

    const sync = () => {
      stop();
      if (media.matches) start();
    };

    sync();
    media.addEventListener("change", sync);
    return () => {
      media.removeEventListener("change", sync);
      stop();
    };
  }, []);

  return (
    <div className={styles.scene} aria-hidden="true">
      <div className={styles.wash} />
      <div className={styles.drift} />
      <div ref={spotRef} className={styles.spot} hidden />
    </div>
  );
}

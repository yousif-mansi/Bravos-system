"use client";

import { useState, useSyncExternalStore } from "react";
import styles from "./brand-marquee.module.css";

const PHRASE = "Bravos Menswear";
const PHRASE_REPEAT = 10;

function marqueePhrases() {
  return Array.from({ length: PHRASE_REPEAT }, (_, index) => (
    <span key={index} className={styles.phrase} aria-hidden={index === 0 ? undefined : true}>{PHRASE}</span>
  ));
}

function subscribe(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function BrandMarquee() {
  const reduced = useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
  const [held, setHeld] = useState(false);
  const paused = reduced || held;
  const label = reduced ? "Motion paused" : held ? "Resume ticker" : "Pause ticker";

  return (
    <section className={styles.marquee} data-paused={paused ? "true" : "false"}>
      <button
        type="button"
        className={styles.pause}
        aria-pressed={paused}
        aria-label={label}
        disabled={reduced}
        onClick={() => setHeld((value) => !value)}
      >
        <span className={styles.glyph} data-icon={reduced || !held ? "pause" : "play"} aria-hidden="true" />
      </button>
      <div className={styles.viewport}>
        <div className={styles.track}>
          <p className={styles.line}>{marqueePhrases()}</p>
          <p className={`${styles.line} ${styles.duplicate}`} aria-hidden="true">{marqueePhrases()}</p>
        </div>
      </div>
    </section>
  );
}

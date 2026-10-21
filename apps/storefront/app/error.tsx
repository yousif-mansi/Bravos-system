"use client";

import styles from "./components/collection-controls.module.css";

export default function StorefrontError() {
  return (
    <main id="main-content" className="browse-panel">
      <div className={styles.message} role="alert">
        <p className="eyebrow">Bravos</p>
        <h1>Products could not be loaded</h1>
        <p>This page could not be loaded right now. Try again.</p>
        <button type="button" onClick={() => window.location.reload()}>Try again</button>
      </div>
    </main>
  );
}

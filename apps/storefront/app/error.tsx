"use client";

import styles from "./components/collection-controls.module.css";

export default function StorefrontError() {
  return (
    <main id="main-content" className="browse-panel">
      <div className={styles.message} role="alert">
        <p className="eyebrow">برافوس</p>
        <h1>تعذر تحميل المنتجات</h1>
        <p>تعذر تحميل هذه الصفحة حالياً. حاول مرة أخرى.</p>
        <button type="button" onClick={() => window.location.reload()}>إعادة المحاولة</button>
      </div>
    </main>
  );
}

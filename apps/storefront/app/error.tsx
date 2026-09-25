"use client";

import styles from "./components/collection-controls.module.css";

export default function StorefrontError() {
  return (
    <main id="main-content" className="browse-panel">
      <div className={styles.message} role="alert">
        <h1>تعذر تحميل المنتجات</h1>
        <p>حدث خطأ أثناء قراءة التشكيلة. حاول مرة أخرى.</p>
        <button type="button" onClick={() => window.location.reload()}>إعادة المحاولة</button>
      </div>
    </main>
  );
}

import styles from "./components/collection-controls.module.css";

export default function Loading() {
  return (
    <main id="main-content" className="browse-panel storefront-loading-page">
      <div className={`${styles.message} storefront-loading`} role="status" aria-live="polite">
        <img className="loading-brand" src="/brand/03_Logo-Mark_Ivory.svg" alt="برافوس" width={64} height={64} />
        <p>لحظات...</p>
        <span className="loading-line" aria-hidden="true" />
      </div>
    </main>
  );
}

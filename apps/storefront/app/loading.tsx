import styles from "./components/collection-controls.module.css";

export default function Loading() {
  return (
    <main id="main-content" className="browse-panel">
      <div className={styles.message} role="status" aria-live="polite">
        <p>لحظات...</p>
      </div>
    </main>
  );
}

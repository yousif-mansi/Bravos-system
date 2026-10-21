export default function Loading() {
  return (
    <main id="main-content" className="storefront-loading-page">
      <div className="storefront-loading" role="status" aria-live="polite">
        <img className="loading-brand" src="/brand/03_Logo-Mark_Ivory.svg" alt="" width={64} height={64} />
        <p className="loading-status">One moment</p>
      </div>
      <div className="loading-reserve" aria-hidden="true">
        <span className="loading-band" />
        <span className="loading-row">
          <span />
          <span />
          <span />
        </span>
        <span className="loading-line" />
      </div>
    </main>
  );
}

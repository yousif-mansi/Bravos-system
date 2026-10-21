import Link from "next/link";
import { formatEgp } from "../public-catalog";
import styles from "./cart.module.css";

type CartSummaryProps = {
  itemCount: number;
  merchandiseTotal: number;
  checking: boolean;
  canCheckout: boolean;
  onRefresh: () => void;
};

export function CartSummary({ itemCount, merchandiseTotal, checking, canCheckout, onRefresh }: CartSummaryProps) {
  return (
    <aside className={`cart-summary ${styles.summary}`} aria-label="Bag summary">
      <h2>Bag summary</h2>
      <dl className={styles.summaryRows}>
        <div><dt>Items</dt><dd>{itemCount}</dd></div>
        <div className={styles.merchandiseTotal}><dt>Estimated total</dt><dd>{formatEgp(merchandiseTotal)}</dd></div>
      </dl>
      <p className={styles.summaryNote}>Before discounts and delivery. Review the final total at checkout.</p>
      {canCheckout ? (
        <Link className={`button-link cart-checkout-link ${styles.checkoutLink}`} href="/checkout">Checkout</Link>
      ) : (
        <p className={styles.summaryWarning}>Update the unavailable selections before checkout.</p>
      )}
      <button type="button" className={`secondary-action ${styles.refreshButton}`} disabled={checking} aria-busy={checking} onClick={onRefresh}>
        {checking ? "Updating products…" : "Refresh product details"}
      </button>
      <Link className={styles.continueShopping} href="/#catalog-title">Continue shopping</Link>
      <p className={styles.reservationNote}>Items in your bag are not reserved.</p>
    </aside>
  );
}

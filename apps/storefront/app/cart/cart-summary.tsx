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
    <aside className={`cart-summary ${styles.summary}`} aria-label="ملخص السلة">
      <p className={styles.summaryEyebrow}>قبل إتمام الطلب</p>
      <h2>ملخص السلة</h2>
      <dl className={styles.summaryRows}>
        <div><dt>عدد القطع</dt><dd>{itemCount}</dd></div>
        <div className={styles.merchandiseTotal}><dt>مجموع مبدئي</dt><dd>{formatEgp(merchandiseTotal)}</dd></div>
      </dl>
      <p className={styles.summaryNote}>للمنتجات فقط، قبل الخصومات والتوصيل. راجع المبلغ النهائي في الخطوة التالية.</p>
      {canCheckout ? (
        <Link className={`button-link cart-checkout-link ${styles.checkoutLink}`} href="/checkout">متابعة إتمام الطلب</Link>
      ) : (
        <p className={styles.summaryWarning}>عدّل الاختيارات غير المتوفرة قبل إتمام الطلب.</p>
      )}
      <button type="button" className={`secondary-action ${styles.refreshButton}`} disabled={checking} aria-busy={checking} onClick={onRefresh}>
        {checking ? "جارٍ تحديث المنتجات..." : "تحديث بيانات المنتجات"}
      </button>
      <Link className={styles.continueShopping} href="/#catalog-title">متابعة التسوق</Link>
      <p className={styles.reservationNote}>الدفع نقداً عند الاستلام. نراجع توفر السلة كاملة عند مراجعة السعر، ثم يؤكد ممثل برافوس الطلب عبر واتساب. السلة لا تحجز القطع.</p>
    </aside>
  );
}

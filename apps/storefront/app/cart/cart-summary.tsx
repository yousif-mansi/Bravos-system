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
      <h2>ملخص السلة</h2>
      <dl className={styles.summaryRows}>
        <div><dt>عدد القطع</dt><dd>{itemCount}</dd></div>
        <div className={styles.merchandiseTotal}><dt>إجمالي المنتجات</dt><dd>{formatEgp(merchandiseTotal)}</dd></div>
      </dl>
      <p className={styles.summaryNote}>هذا إجمالي المنتجات فقط. رسوم التوصيل والخصومات والإجمالي النهائي تظهر للمراجعة عند إتمام الطلب.</p>
      {canCheckout ? (
        <Link className={`button-link cart-checkout-link ${styles.checkoutLink}`} href="/checkout">متابعة إتمام الطلب</Link>
      ) : (
        <p className={styles.summaryWarning}>عدّل الاختيارات غير المتوفرة قبل إتمام الطلب.</p>
      )}
      <button type="button" className={`secondary-action ${styles.refreshButton}`} disabled={checking} aria-busy={checking} onClick={onRefresh}>
        {checking ? "لحظات..." : "تحديث المخزون"}
      </button>
      <p className={styles.reservationNote}>إضافة المنتج إلى السلة لا تحجزه. يُراجع التوفر عند إرسال الطلب.</p>
    </aside>
  );
}

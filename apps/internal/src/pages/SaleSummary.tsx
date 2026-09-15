import type { SaleDto } from "@bravos/contracts";
import { formatEgpFromPiasters } from "../money.ts";

export function SaleSummary({ sale }: { sale: SaleDto }) {
  return (
    <section className="card" data-testid="sale-details">
      <h2>تفاصيل البيع</h2>
      <p>الموظف: {sale.soldByDisplayName}</p>
      <p>الفرع: {sale.branch.nameAr}</p>
      <p>وقت الحدوث: {formatTime(sale.occurredAt)}</p>
      <p>وقت التسجيل: {sale.recordedAt ? formatTime(sale.recordedAt) : "غير مسجّل بعد"}</p>
      {sale.customerName ? <p>الزبون: {sale.customerName}</p> : <p className="muted">بدون اسم زبون</p>}
      <p>الأصلي: {formatEgpFromPiasters(sale.originalTotalPiasters)}</p>
      {sale.appliedAutomaticOffer ? (
        <p data-testid="sale-automatic-offer">
          العرض التلقائي: {sale.appliedAutomaticOffer.nameAr} — {formatEgpFromPiasters(sale.automaticOfferDiscountPiasters)}
        </p>
      ) : null}
      {sale.appliedCoupon ? (
        <p data-testid="sale-coupon">
          الكوبون: {sale.appliedCoupon.code} — {formatEgpFromPiasters(sale.couponDiscountPiasters)}
        </p>
      ) : null}
      <p>خصم الموظف: {formatEgpFromPiasters(sale.employeeDiscountPiasters)}</p>
      <p>الإجمالي: {formatEgpFromPiasters(sale.finalTotalPiasters)}</p>
      {sale.discountReason ? <p>سبب الخصم: {sale.discountReason}</p> : null}
      {sale.discrepancy ? <p role="alert">{sale.discrepancy.messageAr}</p> : null}
      <ul>
        {sale.lines.map((line) => (
          <li key={line.id}>
            {line.variant.product.code} / {line.variant.size.nameAr} / {line.variant.color.nameAr} — {line.quantity} × {formatEgpFromPiasters(line.listedUnitPricePiasters)}
            {" "}مدفوع {formatEgpFromPiasters(line.paidPiasters)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" });
}

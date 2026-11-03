import { useEffect, useRef, useState } from "react";
import type { SaleDto } from "@bravos/contracts";
import { accountGeneration } from "../account-session.ts";
import { formatEgpFromPiasters } from "../money.ts";
import { customerReceiptNumber, RECEIPT_NUMBER_CONFLICT } from "../receipt-number.ts";
import {
  printSaleReceipt,
  receiptPhoneWarning,
  ReceiptPrintError,
  resolveReceiptOptions,
  type ReceiptPrintResult,
} from "../receipts/index.ts";

const RECEIPT_PRINT_REQUESTED =
  "تم طلب طباعة الإيصال. إذا لم يخرج، يمكنك إعادة الطباعة.";
const RECEIPT_CONNECTOR_SUBMITTED =
  "أُرسل الإيصال إلى طابعة الإيصالات. هذا تسليم لبرنامج الطباعة فقط، وليس خروج الورق. إذا لم يخرج، تحقق من الطابعة ثم أعد الطباعة.";

export function receiptPrintStatus(result: ReceiptPrintResult): string {
  return result.channel === "connector" ? RECEIPT_CONNECTOR_SUBMITTED : RECEIPT_PRINT_REQUESTED;
}

export function receiptPrintFailureMessage(error: unknown): string {
  if (error instanceof ReceiptPrintError) {
    return error.message;
  }
  return "تعذرت طباعة الإيصال. البيع محفوظ. يمكنك إعادة طباعة الإيصال.";
}

export async function printCompletedBranchReceipt(
  sale: SaleDto,
  onProgress?: (message: string) => void,
): Promise<ReceiptPrintResult> {
  return onProgress ? printSaleReceipt(sale, {}, onProgress) : printSaleReceipt(sale);
}

export function SaleSummary({
  sale,
  printDisabled = false,
}: {
  sale: SaleDto;
  printDisabled?: boolean;
}) {
  const [printError, setPrintError] = useState("");
  const [printStatus, setPrintStatus] = useState("");
  const [printing, setPrinting] = useState(false);
  const mountedRef = useRef(true);
  const saleIdRef = useRef(sale.id);
  saleIdRef.current = sale.id;
  const options = resolveReceiptOptions();
  const phoneWarning = receiptPhoneWarning(options);
  const canReprint = sale.physicallyCompleted === true;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function reprint(): Promise<void> {
    if (printDisabled || printing || !canReprint) {
      return;
    }
    const saleId = sale.id;
    const generation = accountGeneration();
    const jobLive = () =>
      mountedRef.current && saleIdRef.current === saleId && accountGeneration() === generation;
    setPrintError("");
    setPrintStatus("جارٍ تجهيز الإيصال…");
    setPrinting(true);
    try {
      const result = await printCompletedBranchReceipt(sale, (message) => {
        if (jobLive()) setPrintStatus(message);
      });
      if (!jobLive()) {
        return;
      }
      setPrintStatus(receiptPrintStatus(result));
    } catch (caught) {
      if (!jobLive()) {
        return;
      }
      setPrintStatus("");
      setPrintError(receiptPrintFailureMessage(caught));
    } finally {
      if (mountedRef.current && saleIdRef.current === saleId) {
        setPrinting(false);
      }
    }
  }

  return (
    <section className="card" data-testid="sale-details">
      <h2>تفاصيل البيع</h2>
      <p>رقم الإيصال: {customerReceiptNumber({
        receiptReference: sale.receiptReference ?? null,
        reference: sale.reference,
        blockedIds: [sale.id, sale.operationId],
      })}</p>
      {sale.receiptNumberingConflict ? <p data-testid="receipt-number-conflict">{RECEIPT_NUMBER_CONFLICT}</p> : null}
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
      <p>طريقة الدفع: {sale.payment.method === "cash" ? "نقداً" : sale.payment.method === "online" ? "إلكترونياً" : "مقسّم"}</p>
      {sale.payment.method === "split" ? <p>نقداً: {formatEgpFromPiasters(sale.payment.cashPiasters)} · إلكترونياً: {formatEgpFromPiasters(sale.payment.onlinePiasters)}</p> : null}
      {sale.exchangeCreditAppliedPiasters > 0 ? (
        <p data-testid="sale-exchange-settlement">
          رصيد إرجاع مستخدم: {formatEgpFromPiasters(sale.exchangeCreditAppliedPiasters)} · نقد محصل فعلياً: {formatEgpFromPiasters(sale.cashReceivedPiasters)}
        </p>
      ) : null}
      {sale.discountReason ? <p>سبب الخصم: {sale.discountReason}</p> : null}
      {sale.discrepancy ? <p role="alert">{sale.discrepancy.messageAr}</p> : null}
      {sale.couponUsageDiscrepancy ? (
        <div className="error" data-testid="coupon-usage-discrepancy" role="alert">
          <p>{sale.couponUsageDiscrepancy.messageAr}</p>
          <p>
            الكوبون: {sale.couponUsageDiscrepancy.couponCode} — خصم {formatEgpFromPiasters(sale.couponUsageDiscrepancy.couponDiscountPiasters)}
          </p>
          <p>
            الاستخدام الفعلي: {sale.couponUsageDiscrepancy.centralUsedCount} من حد {sale.couponUsageDiscrepancy.usageLimit}
          </p>
          <p>وقت اكتشاف التعارض: {formatTime(sale.couponUsageDiscrepancy.detectedAt)}</p>
        </div>
      ) : null}
      <ul>
        {sale.lines.map((line) => (
          <li key={line.id}>
            {line.variant.product.code} / {line.variant.size.nameAr} / {line.variant.color.nameAr} — {line.quantity} × {formatEgpFromPiasters(line.listedUnitPricePiasters)}
            {" "}مدفوع {formatEgpFromPiasters(line.paidPiasters)}
          </li>
        ))}
      </ul>
      {canReprint ? (
        <div className="actions">
          {phoneWarning ? <p className="muted" data-testid="receipt-phone-warning">{phoneWarning}</p> : null}
          {printStatus ? <p className="notice" role="status" data-testid="receipt-print-status">{printStatus}</p> : null}
          {printError ? <p className="error" role="alert" data-testid="receipt-print-error">{printError}</p> : null}
          <button
            type="button"
            className="secondary"
            data-testid="reprint-receipt"
            disabled={printDisabled || printing}
            aria-busy={printing}
            onClick={() => void reprint()}
          >
            {printing ? "جارٍ تجهيز الإيصال…" : "طباعة الإيصال"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" });
}

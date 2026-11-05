import type { SaleDto, SalePaymentDto } from "@bravos/contracts";

export type DisplayedSaleAmounts = {
  originalTotalPiasters: number;
  automaticOfferDiscountPiasters: number;
  couponDiscountPiasters: number;
  employeeDiscountPiasters: number;
  finalTotalPiasters: number;
  paymentMethod: SalePaymentDto["method"];
  cashPiasters: number;
  onlinePiasters: number;
};

export function estimatedSaleTotal(listedTotal: number, employeeDiscountPiasters: number): number {
  return Math.max(0, listedTotal - employeeDiscountPiasters);
}

export function displayedSaleAmounts(input: {
  quote: SaleDto | null;
  cartListedTotal: number;
  employeeDiscountPiasters: number;
  paymentMethod: SalePaymentDto["method"];
  cashPiasters: number | null;
  onlinePiasters: number | null;
}): DisplayedSaleAmounts {
  const finalTotalPiasters = input.quote?.finalTotalPiasters
    ?? estimatedSaleTotal(input.cartListedTotal, input.employeeDiscountPiasters);
  const payment = paymentForDisplayedTotal(
    input.paymentMethod,
    finalTotalPiasters,
    input.cashPiasters,
    input.onlinePiasters,
  );
  return {
    originalTotalPiasters: input.quote?.originalTotalPiasters ?? input.cartListedTotal,
    automaticOfferDiscountPiasters: input.quote?.automaticOfferDiscountPiasters ?? 0,
    couponDiscountPiasters: input.quote?.couponDiscountPiasters ?? 0,
    employeeDiscountPiasters: input.quote?.employeeDiscountPiasters ?? input.employeeDiscountPiasters,
    finalTotalPiasters,
    paymentMethod: payment.method,
    cashPiasters: payment.cashPiasters,
    onlinePiasters: payment.onlinePiasters,
  };
}

export function quotedSaleAmounts(quote: SaleDto, payment?: SalePaymentDto): DisplayedSaleAmounts {
  const pay = payment ?? quote.payment;
  return {
    originalTotalPiasters: quote.originalTotalPiasters,
    automaticOfferDiscountPiasters: quote.automaticOfferDiscountPiasters,
    couponDiscountPiasters: quote.couponDiscountPiasters,
    employeeDiscountPiasters: quote.employeeDiscountPiasters,
    finalTotalPiasters: quote.finalTotalPiasters,
    paymentMethod: pay.method,
    cashPiasters: pay.cashPiasters,
    onlinePiasters: pay.onlinePiasters,
  };
}

export function saleAmountsDiffer(before: DisplayedSaleAmounts, after: DisplayedSaleAmounts): boolean {
  return before.originalTotalPiasters !== after.originalTotalPiasters
    || before.automaticOfferDiscountPiasters !== after.automaticOfferDiscountPiasters
    || before.couponDiscountPiasters !== after.couponDiscountPiasters
    || before.employeeDiscountPiasters !== after.employeeDiscountPiasters
    || before.finalTotalPiasters !== after.finalTotalPiasters
    || before.paymentMethod !== after.paymentMethod
    || before.cashPiasters !== after.cashPiasters
    || before.onlinePiasters !== after.onlinePiasters;
}

export function paymentForDisplayedTotal(
  method: SalePaymentDto["method"],
  total: number,
  cashPiasters: number | null,
  onlinePiasters: number | null,
): SalePaymentDto {
  if (method === "online") return { method: "online", cashPiasters: 0, onlinePiasters: total };
  if (method === "split") {
    return {
      method: "split",
      cashPiasters: cashPiasters ?? 0,
      onlinePiasters: onlinePiasters ?? 0,
    };
  }
  return { method: "cash", cashPiasters: total, onlinePiasters: 0 };
}

export const AMOUNT_CONFIRMATION_NOTICE = "تم تحديث المبالغ المستحقة. أكّد إتمام البيع.";

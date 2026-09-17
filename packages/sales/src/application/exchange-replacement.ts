import { OperationConflictError, type InventoryTransaction } from "@bravos/inventory";
import { assertMergedSaleQuantities, priceSaleLines } from "../domain/discount.ts";
import { SalesValidationError } from "../domain/errors.ts";
import type {
  AutomaticPricingPort,
  ExchangeReplacementAcceptedQuote,
  ExchangeReplacementPricing,
  ExchangeReplacementSaleWriter,
  ListedPriceReader,
  PricingQuoteReader,
  RestoreRuntimePort,
  SaleLineWrite,
  SaleStore,
} from "./ports.ts";

async function priceReplacement(
  prices: ListedPriceReader,
  automaticPricing: AutomaticPricingPort,
  lines: Array<{ variantId: string; quantity: number }>,
  at: Date,
): Promise<ExchangeReplacementAcceptedQuote> {
  const quantities = assertMergedSaleQuantities(lines);
  const listed = await prices.getListedPrices(quantities.map((line) => line.variantId));
  const byId = new Map(listed.map((row) => [row.variantId, row]));
  if (byId.size !== quantities.length) throw new SalesValidationError("المتغير المحدد غير موجود.");
  const basket = quantities.map((line) => {
    const basis = byId.get(line.variantId);
    if (!basis) throw new SalesValidationError("المتغير المحدد غير موجود.");
    return {
      variantId: line.variantId,
      productId: basis.productId,
      categoryId: basis.categoryId,
      quantity: line.quantity,
      listedUnitPricePiasters: basis.listedUnitPricePiasters,
    };
  });
  const automatic = await automaticPricing.evaluate(basket, at, null);
  const priced = priceSaleLines(
    basket,
    0,
    automatic.appliedAutomaticOffer ? automatic.unitRanges : undefined,
    automatic.appliedCoupon ? automatic.couponUnitRanges : undefined,
  );
  return {
    originalTotalPiasters: priced.originalTotalPiasters,
    finalTotalPiasters: priced.finalTotalPiasters,
    automaticOfferDiscountPiasters: priced.lines.reduce(
      (sum, line) => sum + line.automaticOfferDiscountPiasters,
      0,
    ),
    appliedAutomaticOffer: automatic.appliedAutomaticOffer,
    lines: priced.lines,
  };
}

export function createExchangeReplacementPricing(pricing: PricingQuoteReader): ExchangeReplacementPricing {
  return {
    quote: (lines, at) => pricing.run((ports) => priceReplacement(ports.prices, ports.automaticPricing, lines, at)),
  };
}

export function createExchangeReplacementSaleWriter(ports: {
  sales: SaleStore;
  inventory: InventoryTransaction;
  restore: RestoreRuntimePort;
}): ExchangeReplacementSaleWriter {
  return {
    async create(input) {
      await ports.sales.lockIdentities(input.saleId, input.operationId);
      const existingById = await ports.sales.getById(input.saleId);
      const existingByOperation = await ports.sales.getByOperationId(input.operationId);
      const existing = existingById ?? existingByOperation;
      if (existing) {
        if (existing.id !== input.saleId || existing.operationId !== input.operationId
          || existing.payloadFingerprint !== input.payloadFingerprint) {
          throw new OperationConflictError();
        }
        return {
          sale: existing,
          allocations: await ports.inventory.listAllocations(existing.operationId),
          creditAppliedPiasters: existing.exchangeCreditAppliedPiasters,
          cashCollectedPiasters: existing.cashReceivedPiasters,
        };
      }

      const priced = input.acceptedQuote;
      assertMergedSaleQuantities(priced.lines);
      const creditAppliedPiasters = Math.min(input.creditAvailablePiasters, priced.finalTotalPiasters);
      const cashCollectedPiasters = priced.finalTotalPiasters - creditAppliedPiasters;
      const claimed = await ports.inventory.claimSaleOperation({
        operationId: input.operationId,
        payloadFingerprint: input.payloadFingerprint,
        actorStaffId: input.actorStaffId,
      });
      if (claimed.kind === "replay") throw new OperationConflictError();

      const completedLines: SaleLineWrite[] = [];
      for (const [lineIndex, line] of priced.lines.entries()) {
        const allocated = await ports.inventory.allocateFromOldestAvailable({
          operationId: input.operationId,
          variantId: line.variantId,
          quantity: line.quantity,
          recordedAt: claimed.recordedAt,
          allowPartial: false,
        });
        completedLines.push({
          id: crypto.randomUUID(),
          variantId: line.variantId,
          quantity: line.quantity,
          listedUnitPricePiasters: line.listedUnitPricePiasters,
          originalPiasters: line.originalPiasters,
          discountPiasters: line.discountPiasters,
          paidPiasters: line.paidPiasters,
          automaticOfferDiscountPiasters: line.automaticOfferDiscountPiasters,
          couponDiscountPiasters: line.couponDiscountPiasters,
          employeeDiscountPiasters: 0,
          allocatedQuantity: allocated.allocatedQuantity,
          unallocatedQuantity: 0,
          lineIndex,
          units: line.units.map((unit) => ({ ...unit, employeeDiscountPiasters: 0 })),
        });
      }
      const restore = await ports.restore.current();
      const inserted = await ports.sales.insert({
        sourceRestoreGeneration: restore.generation,
        id: input.saleId,
        operationId: input.operationId,
        branchId: input.branchId,
        soldByStaffId: input.actorStaffId,
        soldByDisplayName: input.actorDisplayName,
        discountedByStaffId: null,
        occurredAt: input.occurredAt,
        recordedAt: claimed.recordedAt,
        customerName: null,
        customerPhone: null,
        originalTotalPiasters: priced.originalTotalPiasters,
        automaticOfferDiscountPiasters: priced.automaticOfferDiscountPiasters,
        appliedAutomaticOffer: priced.appliedAutomaticOffer,
        couponDiscountPiasters: 0,
        appliedCoupon: null,
        couponUsageDiscrepancy: null,
        employeeDiscountPiasters: 0,
        discountReason: null,
        finalTotalPiasters: priced.finalTotalPiasters,
        exchangeCreditAppliedPiasters: creditAppliedPiasters,
        cashReceivedPiasters: cashCollectedPiasters,
        payloadFingerprint: input.payloadFingerprint,
        physicallyCompleted: true,
        costsIncomplete: false,
        lines: completedLines,
      });
      if (inserted.kind !== "created") throw new OperationConflictError();
      return {
        sale: inserted.record,
        allocations: await ports.inventory.listAllocations(input.operationId),
        creditAppliedPiasters,
        cashCollectedPiasters,
      };
    },
    getById: (id) => ports.sales.getById(id),
    listAllocations: (operationId) => ports.inventory.listAllocations(operationId),
  };
}

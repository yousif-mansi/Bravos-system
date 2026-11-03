import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { piastersToEgpInput } from "../../apps/internal/src/money.ts";
import { offlineFromQuote, saleFromOffline } from "../../apps/internal/src/pos.ts";
import { PENDING_RECEIPT_NUMBER, preservedSummaryReceipt, withPreservedLocalReceipt } from "../../apps/internal/src/receipt-number.ts";
import {
  buildReceiptView,
  contentWidthMm,
  formatCairoDateTime,
  isCompletedSale,
  localOperationReference,
  RECEIPT_MAX_PAGE_HEIGHT_MM,
  receiptPageSizeCss,
  receiptPageSizeMm,
} from "../../apps/internal/src/receipts/receipt-model.ts";
import {
  findCachedProductByCode,
  productCodeKey,
  productCodesEqual,
} from "../../apps/internal/src/pages/pos/useProductCodeScanner.ts";

const OPERATION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CUSTOMER_PHONE = "01099887766";
const DISCOUNT_REASON = "سبب داخلي سري";
const UNIT_COST_PIASTERS = 11111;

function money(piasters) {
  return piastersToEgpInput(piasters);
}

function line(overrides) {
  return {
    id: "line-1",
    variantId: "variant-1",
    quantity: 1,
    listedUnitPricePiasters: 30000,
    originalPiasters: 30000,
    discountPiasters: 2500,
    paidPiasters: 27500,
    automaticOfferDiscountPiasters: 0,
    couponDiscountPiasters: 0,
    employeeDiscountPiasters: 2500,
    allocatedQuantity: 1,
    unallocatedQuantity: 0,
    units: [],
    variant: {
      id: "variant-1",
      product: { id: "product-1", code: "BRV-001", nameAr: "قميص" },
      size: { id: "size-m", nameAr: "M" },
      color: { id: "color-black", nameAr: "أسود" },
    },
    ...overrides,
  };
}

function saleFixture(overrides = {}) {
  const base = {
    id: "sale-1",
    reference: null,
    operationId: OPERATION_ID,
    branch: { id: "branch-1", nameAr: "فرع مدينة نصر" },
    soldByStaffId: "staff-1",
    soldByDisplayName: "أمين الصندوق",
    occurredAt: "2026-01-15T22:30:00.000Z",
    recordedAt: null,
    customerName: null,
    customerPhone: CUSTOMER_PHONE,
    originalTotalPiasters: 50000,
    automaticOfferDiscountPiasters: 0,
    appliedAutomaticOffer: null,
    couponDiscountPiasters: 0,
    appliedCoupon: null,
    employeeDiscountPiasters: 5000,
    discountReason: DISCOUNT_REASON,
    discountedByStaffId: null,
    finalTotalPiasters: 45000,
    exchangeCreditAppliedPiasters: 0,
    cashReceivedPiasters: 45000,
    payment: { method: "cash", cashPiasters: 45000, onlinePiasters: 0 },
    physicallyCompleted: true,
    discrepancy: null,
    lines: [
      line({}),
      line({
        id: "line-2",
        variantId: "variant-2",
        quantity: 2,
        listedUnitPricePiasters: 99999,
        originalPiasters: 20000,
        discountPiasters: 2500,
        paidPiasters: 17500,
        employeeDiscountPiasters: 2500,
        variant: {
          id: "variant-2",
          product: { id: "product-2", code: "BRV-002", nameAr: "Navy Linen Shirt" },
          size: { id: "size-l", nameAr: "L" },
          color: { id: "color-navy", nameAr: "كحلي" },
        },
      }),
    ],
    unitCostPiasters: UNIT_COST_PIASTERS,
  };
  return { ...base, ...overrides };
}

test("cached product lookup matches case, NFC, and trim and misses unknown codes", () => {
  const products = [
    { code: "  AbC\u0301-01 ", nameAr: "منتج" },
    { code: "PLAIN", nameAr: "آخر" },
  ];
  const entered = "abc\u0301-01";
  assert.equal(productCodeKey("  AbC\u0301-01 "), productCodeKey(entered));
  assert.equal(productCodesEqual("  AbC\u0301-01 ", "ABC\u0301-01"), true);
  assert.equal(productCodesEqual("PLAIN", "other"), false);
  assert.equal(findCachedProductByCode(products, "  abc\u0301-01 ")?.nameAr, "منتج");
  assert.equal(findCachedProductByCode(products, "plain")?.code, "PLAIN");
  assert.equal(findCachedProductByCode(products, "UNKNOWN-CODE"), undefined);
});

test("receipt keeps original Arabic and English product names", () => {
  const sale = saleFixture();
  const view = buildReceiptView(structuredClone(sale), {
    paperWidthMm: 80,
    contactPhone: "01011112222",
  });
  assert.deepEqual(
    view.lines.map((item) => item.productName),
    ["قميص", "Navy Linen Shirt"],
  );
  assert.deepEqual(
    view.lines.map((item) => item.productCode),
    ["BRV-001", "BRV-002"],
  );
  assert.equal(view.lines[0].sizeName, "M");
  assert.equal(view.lines[0].colorName, "أسود");
  assert.equal(view.lines[1].colorName, "كحلي");
});

test("financial lines use stored originals, discounts, and final total", () => {
  const sale = structuredClone(saleFixture());
  const before = structuredClone(sale);
  const view = buildReceiptView(sale, { paperWidthMm: 80, contactPhone: "" });
  assert.equal(view.lines[0].lineOriginal, money(30000));
  assert.equal(view.lines[0].linePaid, money(27500));
  assert.equal(view.lines[0].quantityAndUnitPrice, `1 × ${money(30000)}`);
  assert.equal(view.lines[1].lineOriginal, money(20000));
  assert.equal(view.lines[1].linePaid, money(17500));
  assert.equal(view.lines[1].quantityAndUnitPrice, `2 × ${money(99999)}`);
  assert.notEqual(view.lines[1].lineOriginal, money(99999 * 2));
  assert.notEqual(view.lines[1].linePaid, money(99999 * 2));
  assert.deepEqual(view.adjustments, [
    { label: "الإجمالي قبل الخصم", amount: money(50000) },
    { label: "خصم الموظف", amount: money(5000) },
  ]);
  assert.equal(view.finalTotal, money(45000));
  assert.equal(view.finalTotal, money(sale.finalTotalPiasters));
  assert.equal(view.finalTotal.includes("ج.م."), false);
  assert.equal(view.finalTotal.includes("EGP"), false);
  assert.deepEqual(sale, before);
});

test("split stored allocation and a zero final total stay on stored figures", () => {
  const split = structuredClone(saleFixture({ payment: { method: "split", cashPiasters: 15000, onlinePiasters: 30000 } }));
  assert.equal(split.lines[0].paidPiasters, 27500);
  assert.equal(split.lines[1].paidPiasters, 17500);
  assert.equal(split.lines[0].paidPiasters + split.lines[1].paidPiasters, 45000);
  const view = buildReceiptView(split, { paperWidthMm: 58, contactPhone: " " });
  assert.equal(view.lines[0].lineOriginal, money(split.lines[0].originalPiasters));
  assert.equal(view.lines[0].linePaid, money(split.lines[0].paidPiasters));
  assert.equal(view.lines[1].lineOriginal, money(split.lines[1].originalPiasters));
  assert.equal(view.lines[1].linePaid, money(split.lines[1].paidPiasters));
  assert.equal(view.paymentMethodLabel, "مقسّم نقدي وإلكتروني");
  assert.deepEqual(view.paymentAllocations, [
    { label: "المبلغ النقدي", amount: money(15000) },
    { label: "المبلغ الإلكتروني", amount: money(30000) },
  ]);

  const zero = structuredClone(
    saleFixture({
      originalTotalPiasters: 15000,
      employeeDiscountPiasters: 15000,
      finalTotalPiasters: 0,
      cashReceivedPiasters: 0,
      payment: { method: "split", cashPiasters: 0, onlinePiasters: 0 },
      lines: [line({ originalPiasters: 15000, paidPiasters: 0, discountPiasters: 15000, employeeDiscountPiasters: 15000 })],
    }),
  );
  const zeroView = buildReceiptView(zero, { paperWidthMm: 80, contactPhone: "" });
  assert.equal(zeroView.finalTotal, money(0));
  assert.equal(zeroView.lines[0].lineOriginal, money(15000));
  assert.equal(zeroView.lines[0].linePaid, money(0));
  assert.deepEqual(zeroView.paymentAllocations, [
    { label: "المبلغ النقدي", amount: money(0) },
    { label: "المبلغ الإلكتروني", amount: money(0) },
  ]);
  assert.equal(zeroView.paymentMethodLabel, "مقسّم نقدي وإلكتروني");
});

test("exchange credit is separate from cash actually collected", () => {
  const sale = structuredClone(
    saleFixture({
      finalTotalPiasters: 45000,
      exchangeCreditAppliedPiasters: 20000,
      cashReceivedPiasters: 25000,
      payment: { method: "cash", cashPiasters: 25000, onlinePiasters: 0 },
    }),
  );
  const view = buildReceiptView(sale, { paperWidthMm: 80, contactPhone: "022222" });
  assert.equal(view.exchangeCredit, money(20000));
  assert.equal(view.cashCollected, money(25000));
  assert.deepEqual(view.paymentAllocations, [{ label: "المبلغ النقدي", amount: money(25000) }]);
  assert.notEqual(view.cashCollected, view.finalTotal);

  const plain = buildReceiptView(structuredClone(saleFixture()), {
    paperWidthMm: 80,
    contactPhone: "",
  });
  assert.equal(plain.exchangeCredit, null);
  assert.equal(plain.cashCollected, null);
});

test("58mm and 80mm paper map to content widths 48 and 72", () => {
  assert.equal(contentWidthMm(58), 48);
  assert.equal(contentWidthMm(80), 72);
  const narrow = buildReceiptView(structuredClone(saleFixture()), {
    paperWidthMm: 58,
    contactPhone: "1",
  });
  const wide = buildReceiptView(structuredClone(saleFixture()), {
    paperWidthMm: 80,
    contactPhone: "1",
  });
  assert.equal(narrow.contentWidthMm, 48);
  assert.equal(wide.contentWidthMm, 72);
});

test("printed reference prefers the server reference and keeps the full operation id", () => {
  const fullLocal = localOperationReference(OPERATION_ID);
  assert.equal(fullLocal, `عملية محلية ${OPERATION_ID}`);
  assert.equal(fullLocal.includes(OPERATION_ID), true);
  assert.equal(fullLocal.length, "عملية محلية ".length + OPERATION_ID.length);

  const pending = buildReceiptView(structuredClone(saleFixture({ reference: null })), {
    paperWidthMm: 80,
    contactPhone: "",
  });
  assert.equal(pending.serverReference, null);
  assert.equal(pending.localOperationReference, fullLocal);
  assert.equal(pending.printedReference, PENDING_RECEIPT_NUMBER);
  assert.equal(pending.printedReference.includes(OPERATION_ID), false);
  assert.equal(pending.printedReference.includes("عملية محلية"), false);
  assert.equal(pending.occurredAtLabel, formatCairoDateTime("2026-01-15T22:30:00.000Z"));
  assert.notEqual(pending.occurredAtLabel, "2026-01-15T22:30:00.000Z");
  assert.match(pending.occurredAtLabel, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);

  const synced = buildReceiptView(structuredClone(saleFixture({ reference: "POS-0042" })), {
    paperWidthMm: 80,
    contactPhone: "",
  });
  assert.equal(synced.serverReference, "POS-0042");
  assert.equal(synced.printedReference, "POS-0042");
  assert.equal(synced.localOperationReference, fullLocal);
  assert.notEqual(synced.printedReference, synced.localOperationReference);

  const permanent = buildReceiptView(structuredClone(saleFixture({
    reference: "POS-0042",
    receiptReference: "BRV-001-000001",
  })), {
    paperWidthMm: 80,
    contactPhone: "",
  });
  assert.equal(permanent.serverReference, "POS-0042");
  assert.equal(permanent.printedReference, "BRV-001-000001");
  assert.equal(permanent.printedReference.includes(OPERATION_ID), false);

  const uuidReference = buildReceiptView(structuredClone(saleFixture({
    reference: OPERATION_ID,
    receiptReference: `عملية محلية ${OPERATION_ID}`,
  })), {
    paperWidthMm: 80,
    contactPhone: "",
  });
  assert.equal(uuidReference.printedReference, PENDING_RECEIPT_NUMBER);
});

test("serialized view keeps raw name text and omits cost, staff id, and discount reason", () => {
  const hostile = `<img src=x onerror="alert(1)"><script>steal()</script>`;
  const sale = structuredClone(
    saleFixture({
      customerName: hostile,
      customerPhone: CUSTOMER_PHONE,
      lines: [
        line({
          variant: {
            id: "variant-1",
            product: { id: "product-1", code: `SKU-${hostile}`, nameAr: hostile },
            size: { id: "size-m", nameAr: "M" },
            color: { id: "color-black", nameAr: "أسود" },
          },
        }),
      ],
    }),
  );
  const contactPhone = "01011112222";
  const view = buildReceiptView(sale, { paperWidthMm: 80, contactPhone: `  ${contactPhone}  ` });
  assert.equal(view.lines[0].productName, hostile);
  assert.equal(view.lines[0].productCode, `SKU-${hostile}`);
  assert.equal(view.customerName, hostile);
  assert.equal(view.customerPhone, CUSTOMER_PHONE);
  assert.equal(view.contactPhone, contactPhone);
  const serialized = JSON.stringify(view);
  assert.equal(JSON.parse(serialized).lines[0].productName, hostile);
  assert.equal(JSON.parse(serialized).customerName, hostile);
  assert.equal(serialized.includes("&lt;"), false);
  assert.equal(serialized.includes(CUSTOMER_PHONE), true);
  assert.equal(serialized.includes(DISCOUNT_REASON), false);
  assert.equal(serialized.includes(String(UNIT_COST_PIASTERS)), false);
  assert.equal(serialized.includes("unitCost"), false);
  assert.equal(serialized.includes("staff-1"), false);
  assert.equal(serialized.includes("soldByStaffId"), false);
  assert.equal(serialized.includes(contactPhone), true);
  assert.equal(serialized.includes("ج.م."), false);
  assert.equal(serialized.includes("EGP"), false);
  assert.equal(serialized.includes("$"), false);
});

test("saved customer, cashier, sku, and discounted paid amounts stay stored", () => {
  const sale = structuredClone(
    saleFixture({
      customerName: " سارة علي ",
      customerPhone: `  ${CUSTOMER_PHONE}  `,
      soldByDisplayName: "أمين الصندوق",
    }),
  );
  const before = structuredClone(sale);
  const view = buildReceiptView(sale, { paperWidthMm: 80, contactPhone: "01017412287" });
  assert.equal(view.customerName, "سارة علي");
  assert.equal(view.customerPhone, CUSTOMER_PHONE);
  assert.equal(view.cashierDisplayName, "أمين الصندوق");
  assert.equal(view.lines[0].productCode, "BRV-001");
  assert.equal(view.lines[1].productCode, "BRV-002");
  assert.equal(view.lines[0].lineOriginal, money(30000));
  assert.equal(view.lines[0].linePaid, money(27500));
  assert.equal(view.lines[1].lineOriginal, money(20000));
  assert.equal(view.lines[1].linePaid, money(17500));
  assert.equal(view.contactPhone, "01017412287");
  assert.deepEqual(sale, before);
});

test("missing optional customer details use a neutral placeholder and omit phone", () => {
  const missing = buildReceiptView(structuredClone(saleFixture({ customerName: null, customerPhone: null })), {
    paperWidthMm: 58,
    contactPhone: "",
  });
  assert.equal(missing.customerName, "غير مسجل");
  assert.equal(missing.customerPhone, null);
  assert.equal(missing.cashierDisplayName, "أمين الصندوق");
  assert.equal(missing.contactPhone, null);

  const blank = buildReceiptView(
    structuredClone(saleFixture({ customerName: "   ", customerPhone: " \t ", soldByDisplayName: "  " })),
    { paperWidthMm: 80, contactPhone: " " },
  );
  assert.equal(blank.customerName, "غير مسجل");
  assert.equal(blank.customerPhone, null);
  assert.equal(blank.cashierDisplayName, "غير مسجل");
  assert.equal(blank.contactPhone, null);

  const serialized = JSON.stringify(missing);
  assert.equal(serialized.includes("01099887766"), false);
  assert.equal(serialized.includes("staff-1"), false);
  assert.equal(serialized.includes(DISCOUNT_REASON), false);
});

test("undiscounted lines keep stored original without a separate paid amount", () => {
  const sale = structuredClone(
    saleFixture({
      employeeDiscountPiasters: 0,
      originalTotalPiasters: 30000,
      finalTotalPiasters: 30000,
      cashReceivedPiasters: 30000,
      payment: { method: "cash", cashPiasters: 30000, onlinePiasters: 0 },
      lines: [
        line({
          originalPiasters: 30000,
          discountPiasters: 0,
          paidPiasters: 30000,
          employeeDiscountPiasters: 0,
        }),
      ],
    }),
  );
  const view = buildReceiptView(sale, { paperWidthMm: 80, contactPhone: "" });
  assert.equal(view.lines[0].lineOriginal, money(30000));
  assert.equal(view.lines[0].linePaid, null);
  assert.equal(view.lines[0].quantityAndUnitPrice, `1 × ${money(30000)}`);
  assert.deepEqual(view.adjustments, []);
});

test("long mixed and local-reference text stay complete without invented shortening", () => {
  const longArabic = `قميص صيفي ${"أ".repeat(60)}`;
  const longEnglish = "Navy-Linen-Shirt-Extra-Long-Description-Name";
  const mixed = `${longArabic} / ${longEnglish}`;
  const localId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const sale = structuredClone(
    saleFixture({
      operationId: localId,
      reference: null,
      customerName: mixed,
      soldByDisplayName: `كاشير ${longEnglish}`,
      lines: [
        line({
          variant: {
            id: "variant-1",
            product: { id: "product-1", code: "BRV-VERY-LONG-CODE-001", nameAr: mixed },
            size: { id: "size-m", nameAr: "M-XL-طويل" },
            color: { id: "color-black", nameAr: "أسود / Black" },
          },
        }),
      ],
    }),
  );
  const view = buildReceiptView(sale, { paperWidthMm: 58, contactPhone: "01017412287" });
  assert.equal(view.customerName, mixed);
  assert.equal(view.lines[0].productName, mixed);
  assert.equal(view.lines[0].productCode, "BRV-VERY-LONG-CODE-001");
  assert.equal(view.printedReference, PENDING_RECEIPT_NUMBER);
  assert.equal(view.printedReference.includes(localId), false);
  assert.equal(view.localOperationReference, localOperationReference(localId));
  assert.equal(view.cashierDisplayName, `كاشير ${longEnglish}`);
  assert.equal(view.contentWidthMm, 48);
});

test("receipt amounts stay numeric without currency symbols including zero and fractions", () => {
  const view = buildReceiptView(structuredClone(saleFixture()), { paperWidthMm: 80, contactPhone: "" });
  assert.equal(view.lines[0].quantityAndUnitPrice, "1 × 300");
  assert.equal(view.lines[1].quantityAndUnitPrice, "2 × 999.99");
  assert.equal(view.lines[0].lineOriginal, "300");
  assert.equal(view.lines[0].linePaid, "275");
  assert.equal(view.finalTotal, "450");
  const serialized = JSON.stringify(view);
  for (const token of ["ج.م.", "EGP", "£", "$", "€", "¤"]) {
    assert.equal(serialized.includes(token), false, token);
  }

  const zero = buildReceiptView(
    structuredClone(
      saleFixture({
        originalTotalPiasters: 15000,
        employeeDiscountPiasters: 15000,
        finalTotalPiasters: 0,
        cashReceivedPiasters: 0,
        payment: { method: "split", cashPiasters: 0, onlinePiasters: 0 },
        lines: [line({ originalPiasters: 15000, paidPiasters: 0, discountPiasters: 15000, employeeDiscountPiasters: 15000 })],
      }),
    ),
    { paperWidthMm: 80, contactPhone: "" },
  );
  assert.equal(zero.finalTotal, "0");
  assert.equal(zero.lines[0].linePaid, "0");
});

test("thermal page size uses two millimetre lengths and never auto", () => {
  assert.equal(contentWidthMm(80), 72);
  assert.equal(contentWidthMm(58), 48);
  const short = receiptPageSizeMm(72, 80);
  assert.equal(short.widthMm, 72);
  assert.equal(short.heightMm, Math.ceil(80 / (96 / 25.4) + 1));
  assert.equal(short.heightMm < 297, true);
  const css = receiptPageSizeCss(short.widthMm, short.heightMm);
  assert.match(css, /^@page \{ size: 72mm \d+mm; margin: 0; \}$/);
  assert.equal(css.includes("auto"), false);
  const narrow = receiptPageSizeMm(48, 200);
  assert.equal(narrow.widthMm, 48);
  assert.match(receiptPageSizeCss(narrow.widthMm, narrow.heightMm), /^@page \{ size: 48mm \d+mm; margin: 0; \}$/);
  const long = receiptPageSizeMm(72, 4000);
  assert.equal(long.widthMm, 72);
  assert.equal(long.heightMm, RECEIPT_MAX_PAGE_HEIGHT_MM);
  assert.equal(receiptPageSizeCss(72, long.heightMm).includes("auto"), false);
});

test("prepared server POS reference is kept for immediate local printing", () => {
  const quote = structuredClone(
    saleFixture({
      physicallyCompleted: false,
      reference: "POS-000123",
      operationId: OPERATION_ID,
    }),
  );
  const recorded = offlineFromQuote({
    staffId: "staff-1",
    deviceId: "device-1",
    quote,
    occurredAt: quote.occurredAt,
  });
  assert.equal(recorded.reference, "POS-000123");
  assert.equal(recorded.operationId, OPERATION_ID);
  assert.equal(recorded.payloadFingerprint, null);
  const local = saleFromOffline(recorded);
  assert.equal(local.reference, "POS-000123");
  assert.equal(local.operationId, OPERATION_ID);
  const view = buildReceiptView({ ...local, physicallyCompleted: true }, { paperWidthMm: 80, contactPhone: "" });
  assert.equal(view.printedReference, "POS-000123");
  assert.equal(view.serverReference, "POS-000123");
  assert.equal(view.printedReference.includes(OPERATION_ID), false);
  assert.equal(view.localOperationReference.includes(OPERATION_ID), true);

  const numbered = saleFromOffline({
    ...recorded,
    receiptReference: "BRV-001-000009",
    receiptNumberingConflict: true,
  });
  assert.equal(numbered.reference, "POS-000123");
  assert.equal(numbered.receiptReference, "BRV-001-000009");
  assert.equal(numbered.receiptNumberingConflict, true);
  const preferred = buildReceiptView(numbered, { paperWidthMm: 80, contactPhone: "" });
  assert.equal(preferred.printedReference, "BRV-001-000009");
  assert.equal(preferred.serverReference, "POS-000123");
  const kept = preservedSummaryReceipt(numbered, numbered.id, {
    receiptReference: "BRV-009-999999",
    receiptNumberingConflict: true,
  });
  assert.equal(kept.receiptReference, "BRV-001-000009");
  assert.equal(kept.receiptNumberingConflict, true);
  assert.equal(kept.reference, "POS-000123");
  const otherSale = preservedSummaryReceipt(numbered, "someone-else", { receiptReference: "BRV-009-999999" });
  assert.equal(otherSale, numbered);

  const unsynced = offlineFromQuote({
    staffId: "staff-1",
    deviceId: "device-1",
    quote: structuredClone(saleFixture({ physicallyCompleted: false, reference: null })),
    occurredAt: "2026-01-15T22:30:00.000Z",
  });
  assert.equal(unsynced.reference, null);
  const fallback = buildReceiptView(saleFromOffline(unsynced), { paperWidthMm: 58, contactPhone: "" });
  assert.equal(fallback.printedReference, PENDING_RECEIPT_NUMBER);
  assert.equal(fallback.printedReference.includes(OPERATION_ID), false);
});

test("authorized sale keeps a matching local receipt number only", () => {
  const local = {
    id: "sale-1",
    operationId: OPERATION_ID,
    soldByStaffId: "staff-1",
    branch: { id: "branch-1" },
    receiptReference: "BRV-001-000009",
    finalTotalPiasters: 100,
  };
  const remote = {
    ...local,
    receiptReference: "BRV-009-999999",
    finalTotalPiasters: 45000,
    allocations: [{ batchId: "batch-1", quantity: 1, unitCostPiasters: 111 }],
  };
  const merged = withPreservedLocalReceipt(remote, local, "staff-1");
  assert.equal(merged.receiptReference, "BRV-001-000009");
  assert.equal(merged.receiptNumberingConflict, true);
  assert.equal(merged.finalTotalPiasters, 45000);
  assert.equal(merged.allocations, remote.allocations);
  assert.equal(merged.operationId, OPERATION_ID);

  const withoutLocalNumber = { ...local, receiptReference: undefined };
  const adopted = withPreservedLocalReceipt(remote, withoutLocalNumber, "staff-1");
  assert.equal(adopted.receiptReference, "BRV-009-999999");
  assert.equal(adopted.receiptNumberingConflict, undefined);
  assert.equal(adopted.finalTotalPiasters, 45000);

  assert.equal(withPreservedLocalReceipt(remote, { ...local, id: "sale-2" }, "staff-1"), remote);
  assert.equal(withPreservedLocalReceipt(remote, { ...local, operationId: "other-operation" }, "staff-1"), remote);
  assert.equal(withPreservedLocalReceipt(remote, { ...local, soldByStaffId: "staff-2" }, "staff-1"), remote);
  assert.equal(withPreservedLocalReceipt(remote, { ...local, branch: { id: "branch-2" } }, "staff-1"), remote);
  assert.equal(withPreservedLocalReceipt(remote, local, "staff-2"), remote);
  assert.equal(withPreservedLocalReceipt(remote, null, "staff-1"), remote);
});

test("receipt paper names the customer number رقم الإيصال", () => {
  const source = readFileSync(new URL("../../apps/internal/src/receipts/receipt-document.ts", import.meta.url), "utf8");
  assert.equal(source.includes('detail(doc, receipt, "رقم الإيصال", view.printedReference)'), true);
  assert.equal(source.includes("رقم الطلب"), false);
  assert.equal(source.includes("عملية محلية"), false);
});

test("isCompletedSale rejects a quote that is not physically completed", () => {
  const quote = structuredClone(saleFixture({ physicallyCompleted: false, reference: null }));
  assert.equal(isCompletedSale(quote), false);
  assert.equal(isCompletedSale(structuredClone(saleFixture({ physicallyCompleted: true }))), true);
});

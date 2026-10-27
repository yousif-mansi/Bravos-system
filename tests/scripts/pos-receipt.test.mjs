import assert from "node:assert/strict";
import test from "node:test";
import { formatEgpFromPiasters } from "../../apps/internal/src/money.ts";
import {
  buildReceiptView,
  contentWidthMm,
  formatCairoDateTime,
  isCompletedSale,
  localOperationReference,
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
  return formatEgpFromPiasters(piasters);
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
  assert.equal(view.lines[0].sizeName, "M");
  assert.equal(view.lines[0].colorName, "أسود");
  assert.equal(view.lines[1].colorName, "كحلي");
});

test("financial lines use stored originals, discounts, and final total", () => {
  const sale = structuredClone(saleFixture());
  const before = structuredClone(sale);
  const view = buildReceiptView(sale, { paperWidthMm: 80, contactPhone: "" });
  assert.equal(view.lines[0].lineOriginal, money(30000));
  assert.equal(view.lines[0].quantityAndUnitPrice, `1 × ${money(30000)}`);
  assert.equal(view.lines[1].lineOriginal, money(20000));
  assert.equal(view.lines[1].quantityAndUnitPrice, `2 × ${money(99999)}`);
  assert.notEqual(view.lines[1].lineOriginal, money(99999 * 2));
  assert.deepEqual(view.adjustments, [
    { label: "الإجمالي قبل الخصم", amount: money(50000) },
    { label: "خصم الموظف", amount: money(5000) },
  ]);
  assert.equal(view.finalTotal, money(45000));
  assert.equal(view.finalTotal, money(sale.finalTotalPiasters));
  assert.deepEqual(sale, before);
});

test("split stored allocation and a zero final total stay on stored figures", () => {
  const split = structuredClone(saleFixture({ payment: { method: "split", cashPiasters: 15000, onlinePiasters: 30000 } }));
  assert.equal(split.lines[0].paidPiasters, 27500);
  assert.equal(split.lines[1].paidPiasters, 17500);
  assert.equal(split.lines[0].paidPiasters + split.lines[1].paidPiasters, 45000);
  const view = buildReceiptView(split, { paperWidthMm: 58, contactPhone: " " });
  assert.equal(view.lines[0].lineOriginal, money(split.lines[0].originalPiasters));
  assert.equal(view.lines[1].lineOriginal, money(split.lines[1].originalPiasters));
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
  assert.equal(pending.printedReference, fullLocal);
  assert.equal(pending.occurredAtLabel, formatCairoDateTime("2026-01-15T22:30:00.000Z"));
  assert.notEqual(pending.occurredAtLabel, "2026-01-15T22:30:00.000Z");

  const synced = buildReceiptView(structuredClone(saleFixture({ reference: "POS-0042" })), {
    paperWidthMm: 80,
    contactPhone: "",
  });
  assert.equal(synced.serverReference, "POS-0042");
  assert.equal(synced.printedReference, "POS-0042");
  assert.equal(synced.localOperationReference, fullLocal);
  assert.notEqual(synced.printedReference, synced.localOperationReference);
});

test("serialized view keeps raw name text and omits cost, customer phone, and discount reason", () => {
  const hostile = `<img src=x onerror="alert(1)"><script>steal()</script>`;
  const sale = structuredClone(
    saleFixture({
      lines: [
        line({
          variant: {
            id: "variant-1",
            product: { id: "product-1", code: "BRV-001", nameAr: hostile },
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
  assert.equal(view.contactPhone, contactPhone);
  const serialized = JSON.stringify(view);
  assert.equal(JSON.parse(serialized).lines[0].productName, hostile);
  assert.equal(serialized.includes("&lt;"), false);
  assert.equal(serialized.includes(CUSTOMER_PHONE), false);
  assert.equal(serialized.includes(DISCOUNT_REASON), false);
  assert.equal(serialized.includes(String(UNIT_COST_PIASTERS)), false);
  assert.equal(serialized.includes("unitCost"), false);
  assert.equal(serialized.includes(contactPhone), true);
});

test("isCompletedSale rejects a quote that is not physically completed", () => {
  const quote = structuredClone(saleFixture({ physicallyCompleted: false, reference: null }));
  assert.equal(isCompletedSale(quote), false);
  assert.equal(isCompletedSale(structuredClone(saleFixture({ physicallyCompleted: true }))), true);
});

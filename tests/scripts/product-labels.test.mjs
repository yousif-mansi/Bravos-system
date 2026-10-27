import assert from "node:assert/strict";
import test from "node:test";
import { BitArray, Code128Reader } from "@zxing/library";
import {
  assertLabelSettings,
  encodeProductBarcode,
  LabelPrintError,
  planLabelLayout,
} from "../../apps/internal/src/labels/barcode.ts";
import {
  BrowserPrintBusyError,
  claimBrowserPrint,
  releaseBrowserPrint,
} from "../../apps/internal/src/printing/browser-print-lock.ts";

const QUIET_MODULES = 10;
const DOTS_PER_MODULE = 2;
const PAGE_PADDING_MM = 2;

const STORED_CODES = [
  "A",
  "0",
  "01",
  "012",
  "Brv_TSH.01-Mix",
  "brv.aa_Z-99",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD",
  "aZ0._-Xy9aZ0._-Xy9aZ0._-Xy9aZ0._-Xy9",
];

function product(code, nameAr = "قميص تجريبي") {
  return { id: "prod-label-1", code, nameAr };
}

function settings(overrides = {}) {
  return { widthMm: 160, heightMm: 60, copies: 1, dpi: 203, ...overrides };
}

function decodeModules(modules) {
  const pad = QUIET_MODULES * DOTS_PER_MODULE;
  const row = new BitArray(pad * 2 + modules.length * DOTS_PER_MODULE);
  let index = pad;
  for (const bit of modules) {
    if (bit === "1") {
      row.set(index);
      row.set(index + 1);
    }
    index += DOTS_PER_MODULE;
  }
  return new Code128Reader().decodeRow(0, row).getText();
}

function dotMm(dpi) {
  return (DOTS_PER_MODULE * 25.4) / dpi;
}

test("independent decoder reads the stored product code", () => {
  for (const code of STORED_CODES) {
    const encoded = encodeProductBarcode(code);
    assert.equal(encoded.value, code);
    assert.equal(encoded.quietZoneModules, QUIET_MODULES);
    assert.match(encoded.modules, /^[01]+$/);
    assert.equal(decodeModules(encoded.modules), code);
  }
});

test("invalid codes are rejected and the product is left unchanged", () => {
  for (const code of [null, "", " ", "\t", "bad code", "كود", "a/b", "A".repeat(41)]) {
    const item = product("BRV-KEEP");
    item.code = code;
    const before = { id: item.id, code: item.code, nameAr: item.nameAr };
    assert.throws(() => encodeProductBarcode(code), LabelPrintError);
    assert.throws(
      () => planLabelLayout(item, settings()),
      LabelPrintError,
    );
    assert.deepEqual({ id: item.id, code: item.code, nameAr: item.nameAr }, before);
  }
});

test("203 and 300 dpi layouts use two-dot modules and quiet zones", () => {
  const item = product("Brv_TSH.01-Mix", "تيشيرت");
  for (const dpi of [203, 300]) {
    const layout = planLabelLayout(item, settings({ dpi }));
    const moduleWidthMm = dotMm(dpi);
    const spanned = layout.barcode.modules.length + QUIET_MODULES * 2;
    const minimumWidthMm = Math.ceil((spanned * moduleWidthMm + PAGE_PADDING_MM * 2) * 10) / 10;
    assert.equal(layout.moduleWidthMm, moduleWidthMm);
    assert.equal(layout.barcode.quietZoneModules, QUIET_MODULES);
    assert.equal(layout.barcodeWidthMm, spanned * moduleWidthMm);
    assert.equal(layout.pagePaddingMm, PAGE_PADDING_MM);
    assert.equal(layout.minimumWidthMm, minimumWidthMm);
    assert.ok(layout.settings.widthMm >= layout.minimumWidthMm);
    const acceptedWidthMm = Math.max(40, minimumWidthMm);
    const fitted = planLabelLayout(item, settings({ dpi, widthMm: acceptedWidthMm }));
    assert.equal(fitted.settings.widthMm, acceptedWidthMm);
    assert.ok(fitted.settings.widthMm + 1e-9 >= fitted.minimumWidthMm);
  }
});

test("a narrow label reports the minimum width", () => {
  const item = product("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD", "اسم");
  assert.throws(
    () => planLabelLayout(item, settings({ widthMm: 40 })),
    (error) => error instanceof LabelPrintError && /بعرض .+ مم على الأقل/.test(error.message),
  );
});

test("a short label reports the minimum height", () => {
  assert.throws(
    () => planLabelLayout(product("A", "قميص تجريبي"), settings({ heightMm: 20 })),
    (error) => error instanceof LabelPrintError && /بارتفاع .+ مم على الأقل/.test(error.message),
  );
});

test("copies stop at 100 and other settings are rejected", () => {
  assert.doesNotThrow(() => assertLabelSettings(settings({ copies: 100 })));
  for (const copies of [0, 101, 1.5, Number.NaN]) {
    assert.throws(() => assertLabelSettings(settings({ copies })), LabelPrintError);
  }
  for (const overrides of [
    { dpi: 204 },
    { dpi: 0 },
    { widthMm: 39 },
    { widthMm: 161 },
    { widthMm: Number.NaN },
    { heightMm: 19 },
    { heightMm: 101 },
  ]) {
    assert.throws(() => assertLabelSettings(settings(overrides)), LabelPrintError);
  }
});

test("planning keeps the caller product and does not mutate inputs", () => {
  const item = product("brv.aa_Z-99", "جاكيت");
  const cfg = settings({ copies: 3 });
  const beforeProduct = { id: item.id, code: item.code, nameAr: item.nameAr };
  const beforeSettings = { ...cfg };
  const once = planLabelLayout(item, settings({ copies: 1 }));
  const many = planLabelLayout(item, settings({ copies: 100 }));
  const laid = planLabelLayout(item, cfg);
  assert.equal(once.barcode.value, item.code);
  assert.equal(once.barcode.modules, many.barcode.modules);
  assert.equal(laid.product, item);
  assert.deepEqual(Object.keys(laid.product).sort(), ["code", "id", "nameAr"]);
  assert.deepEqual({ id: item.id, code: item.code, nameAr: item.nameAr }, beforeProduct);
  assert.deepEqual(cfg, beforeSettings);
});

test("the print lock belongs to the claim token", () => {
  const first = claimBrowserPrint();
  try {
    assert.throws(() => claimBrowserPrint(), BrowserPrintBusyError);
    releaseBrowserPrint(Symbol("other"));
    assert.throws(() => claimBrowserPrint(), BrowserPrintBusyError);
    releaseBrowserPrint(first);
    const next = claimBrowserPrint();
    try {
      assert.equal(typeof next, "symbol");
      assert.notEqual(next, first);
    } finally {
      releaseBrowserPrint(next);
    }
  } finally {
    releaseBrowserPrint(first);
  }
});

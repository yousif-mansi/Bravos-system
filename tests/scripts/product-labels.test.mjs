import assert from "node:assert/strict";
import test from "node:test";
import { BitArray, Code128Reader } from "@zxing/library";
import {
  assertLabelSettings,
  encodeProductBarcode,
  formatLabelPriceText,
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

function moduleRow(modules, dots) {
  const pad = QUIET_MODULES * dots;
  const width = pad * 2 + modules.length * dots;
  const row = new BitArray(width);
  let index = pad;
  for (const bit of modules) {
    if (bit === "1") {
      for (let dot = 0; dot < dots; dot += 1) row.set(index + dot);
    }
    index += dots;
  }
  return { row, pad, width };
}

function decodeModules(modules, dots = DOTS_PER_MODULE) {
  const { row, pad, width } = moduleRow(modules, dots);
  for (let index = 0; index < pad; index += 1) {
    assert.equal(Boolean(row.get(index)), false);
    assert.equal(Boolean(row.get(width - 1 - index)), false);
  }
  return new Code128Reader().decodeRow(0, row).getText();
}

function xp(overrides = {}) {
  return {
    widthMm: 38,
    heightMm: 25,
    copies: 1,
    dpi: 203,
    profile: "xp236b-38x25",
    ...overrides,
  };
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
    assert.equal(layout.moduleDots, DOTS_PER_MODULE);
    assert.equal(layout.profile, "generic");
    assert.equal(layout.lineHeight, 1.35);
    assert.equal(layout.codeFontMm, 3.2);
    assert.equal(layout.nameFontMm, 3.6);
    assert.equal(layout.brandFontMm, 3.2);
    assert.equal(layout.priceText, null);
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
    { widthMm: 38 },
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
  assert.equal(cfg.profile, undefined);
});

test("XP-236B 38x25 keeps one native dot for BRV-SAMPLE-001 and ten quiet modules", () => {
  const code = "BRV-SAMPLE-001";
  const item = product(code, "Tapered Twill Pants");
  const cfg = xp();
  const before = { ...cfg };
  const layout = planLabelLayout(item, cfg);
  const total = layout.barcode.modules.length + QUIET_MODULES * 2;
  assert.equal(total, 209);
  assert.equal(layout.barcode.value, code);
  assert.equal(layout.barcode.quietZoneModules, QUIET_MODULES);
  assert.equal(layout.moduleDots, 1);
  assert.equal(layout.profile, "xp236b-38x25");
  assert.equal(layout.settings, cfg);
  assert.deepEqual(cfg, before);
  assert.ok(Math.abs(layout.moduleWidthMm * 203 - 25.4) < 1e-9);
  assert.ok(Math.abs(layout.barcodeWidthMm - (209 * 25.4) / 203) < 1e-9);
  assert.ok(layout.barcodeWidthMm < 38);
  assert.equal(layout.codeFontMm, 2);
  assert.equal(layout.nameFontMm, 1.6);
  assert.equal(layout.brandFontMm, 2);
  assert.equal(layout.priceText, null);
  assert.equal(layout.lineHeight, 1.15);
  assert.ok(layout.barHeightMm >= 10);
  assert.ok(layout.codeFontMm > (13 * 25.4) / 203);
  assert.ok(layout.nameFontMm > (12 * 25.4) / 203);
  assert.equal(decodeModules(layout.barcode.modules, 1), code);
  assert.throws(() => planLabelLayout(item, settings({ widthMm: 38, heightMm: 25 })), LabelPrintError);
});

test("compact profile uses two dots only when that integer width fits", () => {
  const mixed = planLabelLayout(product("brv-tsh-071", "تيشيرت Bravos"), xp());
  const mixedTotal = mixed.barcode.modules.length + QUIET_MODULES * 2;
  const twoDotMinimum = Math.ceil((mixedTotal * (2 * 25.4) / 203 + PAGE_PADDING_MM * 2) * 10) / 10;
  assert.equal(mixed.barcode.value, "brv-tsh-071");
  assert.ok(twoDotMinimum > 38);
  assert.equal(mixed.moduleDots, 1);
  assert.equal(Number.isInteger(mixed.moduleDots), true);
  assert.equal(decodeModules(mixed.barcode.modules, mixed.moduleDots), "brv-tsh-071");

  const shortCode = "aB-7";
  const short = planLabelLayout(product(shortCode, "اسم قصير"), xp());
  const shortTotal = short.barcode.modules.length + QUIET_MODULES * 2;
  const shortTwoDot = Math.ceil((shortTotal * (2 * 25.4) / 203 + PAGE_PADDING_MM * 2) * 10) / 10;
  assert.ok(shortTwoDot <= 38);
  assert.equal(short.moduleDots, 2);
  assert.equal(decodeModules(short.barcode.modules, 2), shortCode);
  assert.ok(Math.abs(short.moduleWidthMm * 203 - 50.8) < 1e-9);
});

test("compact 38x25 accepts a mixed-script name and rejects a name that cannot fit", () => {
  const name = "Tapered Twill Pants بنطال تويل";
  const item = product("BRV-SAMPLE-001", name);
  const layout = planLabelLayout(item, xp());
  assert.equal(layout.product.nameAr, name);
  assert.equal(layout.barcode.value, "BRV-SAMPLE-001");
  assert.ok(layout.barHeightMm + 1e-9 >= 10);
  assert.equal(layout.codeFontMm, 2);
  assert.equal(layout.nameFontMm, 1.6);

  const tooLong = `${"بنطال تويل المفصل ".repeat(24)}Extra English twill that must stay intact`;
  assert.throws(
    () => planLabelLayout(product("BRV-SAMPLE-001", tooLong), xp()),
    (error) => error instanceof LabelPrintError && /بارتفاع .+ مم على الأقل|بعرض .+ مم على الأقل/.test(error.message),
  );
  assert.equal(tooLong.includes("Extra English twill that must stay intact"), true);
});

test("XP-236B profile is optional and rejects a non-203 dpi or a width under 38", () => {
  assert.doesNotThrow(() => assertLabelSettings(xp()));
  assert.doesNotThrow(() => assertLabelSettings(xp({ copies: 100 })));
  assert.doesNotThrow(() => assertLabelSettings(settings()));
  for (const overrides of [
    { dpi: 300 },
    { widthMm: 37 },
    { profile: "receipt-printer" },
    { profile: "generic", widthMm: 38 },
  ]) {
    assert.throws(() => assertLabelSettings(xp(overrides)), LabelPrintError);
  }
  const generic = planLabelLayout(product("A", "قميص"), settings({ dpi: 300, widthMm: 80, heightMm: 40 }));
  assert.equal(generic.moduleDots, 2);
  assert.equal(generic.profile, "generic");
  assert.ok(Math.abs(generic.moduleWidthMm - (2 * 25.4) / 300) < 1e-9);
});

test("saved default price formats zero and decimals and does not invent a missing price", () => {
  assert.equal(formatLabelPriceText(0), "0 EGP");
  assert.equal(formatLabelPriceText(45000), "450 EGP");
  assert.equal(formatLabelPriceText(45050), "450.50 EGP");
  assert.equal(formatLabelPriceText(null), null);
  assert.equal(formatLabelPriceText(undefined), null);
  assert.equal(formatLabelPriceText(12.5), null);
  assert.equal(formatLabelPriceText(-1), null);
  const priced = planLabelLayout(
    { id: "prod-label-1", code: "BRV-071", nameAr: "Basic T-shirt", defaultSellingPricePiasters: 45000 },
    xp(),
  );
  assert.equal(priced.priceText, "450 EGP");
  assert.equal(priced.product.defaultSellingPricePiasters, 45000);
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

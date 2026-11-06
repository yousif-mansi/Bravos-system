import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { inflateSync } from "node:zlib";
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from "@zxing/library";
import { LABEL_PRINTER_NAME, RECEIPT_PRINTER_NAME } from "../../apps/print-connector/src/contracts.ts";
import {
  LABEL_HEIGHT_DOTS,
  LABEL_MIN_BAR_DOTS,
  LABEL_WIDTH_DOTS,
  QUIET_ZONE_MODULES,
  dotsFromHundredths,
  hundredthsOfDots,
  nativeModuleEffects,
} from "../../apps/print-connector/src/renderers/index.ts";
import { prepareNativeJob } from "../../apps/print-connector/src/renderers/job.ts";
import { previewNativeJob, probeNativePrinters, submitNativePrint } from "../../apps/print-connector/src/renderers/api.ts";
import { defaultNativeHelperPath, planNativeHelperSpawn } from "../../apps/print-connector/src/renderers/spawn.ts";

const windows = process.platform === "win32";
const helperPath = defaultNativeHelperPath();

function id(n) {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function labelDocument(name) {
  return {
    kind: "label",
    id: id(1),
    copies: 1,
    product: { code: "BRV-SAMPLE-001", name },
    paper: { widthMm: 38, heightMm: 25 },
    dpi: 203,
    profile: "compact",
  };
}

function labelDispatch(name) {
  return {
    jobId: id(1),
    kind: "label",
    printerName: LABEL_PRINTER_NAME,
    copies: 1,
    document: labelDocument(name),
  };
}

function receiptDocument(lines) {
  return {
    kind: "receipt",
    id: id(2),
    copies: 1,
    receiptView: {
      brand: "BRAVOS",
      branchName: "فرع الفيوم",
      contactPhone: "010-1741.2287 تحويلة",
      printedReference: "BRV-001/000042",
      occurredAtLabel: "31/10/2026، 14:05",
      cashierDisplayName: "منى س.",
      customerName: "أحمد & Co.",
      customerPhone: "٠١٠١٢٣٤٥٦٧٨",
      lines,
      adjustments: [
        { label: "الإجمالي قبل الخصم", amount: "850.00" },
        { label: "خصم الموظف", amount: "50.00" },
      ],
      finalTotal: "800.00",
      exchangeCredit: null,
      cashCollected: null,
      paymentMethodLabel: "نقدي",
      paymentAllocations: [{ label: "المبلغ النقدي", amount: "800.00" }],
      contentWidthMm: 72,
    },
  };
}

function oneLine() {
  return {
    productName: "بنطال تويل — Twill & Co.",
    productCode: "BRV-SAMPLE-001",
    sizeName: "L",
    colorName: "أسود",
    quantityAndUnitPrice: "1 × 850.00",
    lineOriginal: "850.00",
    linePaid: "800.00",
  };
}

function receiptDispatch(count) {
  const lines = [];
  for (let i = 0; i < count; i += 1) lines.push(oneLine());
  return {
    jobId: id(2),
    kind: "receipt",
    printerName: RECEIPT_PRINTER_NAME,
    copies: 1,
    document: receiptDocument(lines),
  };
}

function decodePng(buf) {
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  assert.equal(bitDepth, 8);
  assert.ok(colorType === 2 || colorType === 6);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const pixels = Buffer.alloc(width * height * 4);
  let src = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = Buffer.from(raw.subarray(src, src + stride));
    src += stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bpp ? row[i - bpp] : 0;
      const up = prev[i];
      const ul = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - ul;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - ul);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      } else if (filter !== 0) {
        throw new Error("png_filter");
      }
      row[i] = (row[i] + add) & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const o = x * bpp;
      const d = (y * width + x) * 4;
      pixels[d] = row[o];
      pixels[d + 1] = row[o + 1];
      pixels[d + 2] = row[o + 2];
      pixels[d + 3] = bpp === 4 ? row[o + 3] : 255;
    }
    prev = row;
  }
  return { width, height, pixels };
}

function decodeCode128(pixels, width, height) {
  const ints = new Int32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    ints[i] = (0xff << 24) | (r << 16) | (g << 8) | b;
  }
  const reader = new MultiFormatReader();
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);
  return reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(ints, width, height)))).getText();
}

function assertIntegerModules(pixels, width, preview) {
  const moduleDots = preview.moduleDots;
  const y = Math.floor((preview.barHeightDots ?? 0) / 2);
  assert.ok(y > 0 && y < preview.pageHeightDots);
  const black = [];
  for (let x = 0; x < width; x += 1) {
    black.push(pixels[(y * width + x) * 4] < 128);
  }
  let x = 0;
  while (x < width && !black[x]) x += 1;
  const start = x;
  const runs = [];
  while (x < width) {
    const bit = black[x];
    let n = 0;
    while (x < width && black[x] === bit) {
      n += 1;
      x += 1;
    }
    runs.push(n);
    if (!bit && n > moduleDots * 2) break;
  }
  assert.equal(start, QUIET_ZONE_MODULES * moduleDots + Math.floor((width - preview.barcodeWidthDots) / 2));
  for (const run of runs) {
    assert.equal(run % moduleDots, 0);
    assert.ok(run === moduleDots || run === moduleDots * 2 || run === moduleDots * 3 || run === moduleDots * 4);
  }
}

test("38x25 hundredths rounding keeps a half-dot paper round trip", () => {
  assert.equal(nativeModuleEffects.spawnsOnImport, false);
  assert.equal(LABEL_WIDTH_DOTS, 304);
  assert.equal(LABEL_HEIGHT_DOTS, 200);
  assert.equal(LABEL_MIN_BAR_DOTS, 80);
  const hundredths = hundredthsOfDots(304);
  assert.equal(hundredths, 150);
  const back = dotsFromHundredths(hundredths);
  assert.equal(back.accepted, true);
  assert.equal(Math.abs((150 * 203) / 100 - 304), 0.5);
  assert.equal(Math.abs(back.dots - 304) <= 1, true);
});

test("public contract text with punctuation and an Arabic phone maps once", () => {
  const prepared = prepareNativeJob(receiptDispatch(1));
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(prepared.job.contactPhone, "010-1741.2287 تحويلة");
  assert.equal(prepared.job.customerPhone, "٠١٠١٢٣٤٥٦٧٨");
  assert.equal(prepared.job.occurredAtLabel, "31/10/2026، 14:05");
  assert.equal(prepared.job.lines[0].productName.includes("—"), true);
  assert.equal(JSON.stringify(prepared.job).includes("serverReference"), false);
  const label = prepareNativeJob(labelDispatch("بنطال تويل"));
  assert.equal(label.ok, true);
  if (!label.ok) return;
  assert.equal(label.pageWidthDots, 304);
  assert.equal(label.pageHeightDots, 200);
  assert.equal(label.minimumBarDots, 80);
  assert.equal(label.quietModules, 10);
});

test("PowerShell plan accepts C:\\WINDOWS and a helper path that contains spaces", () => {
  const spacedHelperPath = "C:\\Bravos Test Workspace\\apps\\print-connector\\helpers\\native-print.ps1";
  const plan = planNativeHelperSpawn({ systemRoot: "C:\\WINDOWS", helperPath: spacedHelperPath });
  assert.equal(plan.shell, false);
  assert.equal(plan.windowsHide, true);
  assert.equal(Object.hasOwn(plan, "windowsVerbatimArguments"), false);
  assert.equal(plan.file, "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.deepEqual(plan.args, ["-NoProfile", "-NonInteractive", "-File", spacedHelperPath]);
  assert.equal(plan.args.includes("-Command"), false);
});

test("empty helper stdin never selects print", { skip: !windows }, async () => {
  const plan = planNativeHelperSpawn({ systemRoot: process.env.SystemRoot ?? "C:\\WINDOWS", helperPath });
  const child = spawn(plan.file, [...plan.args], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const done = new Promise((resolve, reject) => {
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: Buffer.concat(chunks).toString("utf8") }));
  });
  child.stdin.end();
  const result = await done;
  assert.equal(result.code, 3);
  assert.equal(result.stdout.includes("printInvoked\":true"), false);
});

test("label preview is 304x200, quiet, integer, and decodes BRV-SAMPLE-001", { skip: !windows }, async () => {
  const preview = await previewNativeJob(labelDispatch("بنطال تويل"), { helperPath });
  assert.equal(preview.ok, true, preview.ok ? undefined : JSON.stringify(preview));
  if (!preview.ok) return;
  assert.equal(preview.printInvoked, false);
  assert.equal(preview.pageWidthDots, 304);
  assert.equal(preview.pageHeightDots, 200);
  assert.equal(preview.quietModules, 10);
  assert.equal(preview.moduleDots === 1 || preview.moduleDots === 2, true);
  assert.ok((preview.barHeightDots ?? 0) >= 80);
  assert.equal(preview.lines.every((line) => line.clipped === false), true);
  const name = preview.lines.find((line) => line.role === "name");
  const code = preview.lines.find((line) => line.role === "code");
  assert.equal(name?.text, "بنطال تويل");
  assert.equal(code?.text, "BRV-SAMPLE-001");
  const page = preview.pages[0];
  assert.ok(page);
  const png = Buffer.from(page.pngBase64, "base64");
  const image = decodePng(png);
  assert.equal(image.width, 304);
  assert.equal(image.height, 200);
  assert.equal(decodeCode128(image.pixels, image.width, image.height), "BRV-SAMPLE-001");
  assertIntegerModules(image.pixels, image.width, preview);
  for (const line of preview.lines) {
    assert.ok(line.x >= 0 && line.y >= 0 && line.x + line.w <= 304 && line.y + line.h <= 200);
  }
});

function lineInk(pixels, width, height, line) {
  const y0 = Math.max(0, line.y);
  const y1 = Math.min(height - 1, line.y + line.h - 1);
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, maxX, minY, maxY, y0, y1 };
}

const RECEIPT_CONTENT_WIDTH_DOTS = 575;

function assertCenteredArabicLine(image, line) {
  const ink = lineInk(image.pixels, image.width, image.height, line);
  assert.ok(ink.maxX >= ink.minX, `${line.role} has ink`);
  const mid = (ink.minX + ink.maxX) / 2;
  const contentMid = RECEIPT_CONTENT_WIDTH_DOTS / 2;
  assert.ok(Math.abs(mid - contentMid) <= 16, `${line.role} ink center ${mid} vs content ${contentMid}`);
  assert.ok(ink.minX >= 0 && ink.maxX < RECEIPT_CONTENT_WIDTH_DOTS);
  for (let y = ink.y0; y <= ink.y1; y += 1) {
    const left = (y * image.width + 0) * 4;
    const right = (y * image.width + (image.width - 1)) * 4;
    assert.ok(image.pixels[left] >= 250 && image.pixels[left + 1] >= 250 && image.pixels[left + 2] >= 250);
    assert.ok(image.pixels[right] >= 250 && image.pixels[right + 1] >= 250 && image.pixels[right + 2] >= 250);
  }
}

function assertReceiptInkInContentBand(pixels, width, height) {
  for (let y = 0; y < height; y += 1) {
    for (let x = RECEIPT_CONTENT_WIDTH_DOTS; x < width; x += 1) {
      const i = (y * width + x) * 4;
      assert.ok(pixels[i] >= 250 && pixels[i + 1] >= 250 && pixels[i + 2] >= 250);
    }
  }
}

test("receipt preview centers short Arabic title, branch, and thanks ink", { skip: !windows }, async () => {
  const preview = await previewNativeJob(receiptDispatch(1), { helperPath });
  assert.equal(preview.ok, true, preview.ok ? undefined : JSON.stringify(preview));
  if (!preview.ok) return;
  assert.equal(preview.printInvoked, false);
  const page = preview.pages[0];
  assert.ok(page);
  const png = Buffer.from(page.pngBase64, "base64");
  const image = decodePng(png);
  assert.equal(image.width, page.widthDots);
  const title = preview.lines.find((line) => line.role === "title" && line.page === 0);
  const branch = preview.lines.find((line) => line.role === "branch" && line.page === 0);
  const thanks = preview.lines.find((line) => line.role === "thanks" && line.page === 0);
  assert.equal(title?.text, "إيصال بيع");
  assert.equal(branch?.text, "فرع الفيوم");
  assert.equal(thanks?.text, "شكرًا لتسوقكم");
  assertCenteredArabicLine(image, title);
  assertCenteredArabicLine(image, branch);
  assertCenteredArabicLine(image, thanks);
  assertReceiptInkInContentBand(image.pixels, image.width, image.height);
  assert.ok(page.ink.minX >= 0 && page.ink.maxX < RECEIPT_CONTENT_WIDTH_DOTS);
});

test("product-level receipt preview omits empty website options without printing", { skip: !windows }, async () => {
  const dispatch = receiptDispatch(1);
  dispatch.document.receiptView.lines[0].sizeName = "";
  dispatch.document.receiptView.lines[0].colorName = "";
  assert.equal(prepareNativeJob(dispatch).ok, true);
  const preview = await previewNativeJob(dispatch, { helperPath });
  assert.equal(preview.ok, true, preview.ok ? undefined : JSON.stringify(preview));
  if (!preview.ok) return;
  assert.equal(preview.printInvoked, false);
  assert.equal(preview.lines.some((line) => line.role === "item-variant"), false);
  assert.equal(preview.lines.some((line) => line.role === "item-name" && line.text.includes("بنطال تويل")), true);
  assert.equal(preview.lines.some((line) => line.role === "total" && line.text.includes("800.00")), true);
  for (const page of preview.pages) {
    assert.ok(page.ink.minX >= 0 && page.ink.maxX < RECEIPT_CONTENT_WIDTH_DOTS);
  }
});

test("receipt preview keeps fields, logo ink, and page bounds", { skip: !windows }, async () => {
  const preview = await previewNativeJob(receiptDispatch(40), { helperPath });
  assert.equal(preview.ok, true, preview.ok ? undefined : JSON.stringify(preview));
  if (!preview.ok) return;
  assert.equal(preview.printInvoked, false);
  assert.ok(preview.pages.length >= 2);
  assert.ok(preview.pages.length <= 6);
  assert.equal(typeof preview.maxPageHeightDots, "number");
  const roles = new Set(preview.lines.map((line) => line.role));
  for (const role of ["branch", "contact", "detail", "item-name", "total", "payment", "thanks"]) {
    assert.equal(roles.has(role), true);
  }
  const texts = preview.lines.map((line) => line.text).join("\n");
  assert.equal(texts.includes("010-1741.2287 تحويلة"), true);
  assert.equal(texts.includes("٠١٠١٢٣٤٥٦٧٨"), true);
  assert.equal(texts.includes("800.00"), true);
  assert.equal(texts.includes("بنطال تويل — Twill & Co."), true);
  for (const page of preview.pages) {
    assert.ok(page.heightDots <= (preview.maxPageHeightDots ?? 0));
    assert.ok(page.ink.minX >= 0 && page.ink.minY >= 0);
    assert.ok(page.ink.maxX < RECEIPT_CONTENT_WIDTH_DOTS && page.ink.maxY < page.heightDots);
    const png = Buffer.from(page.pngBase64, "base64");
    assert.ok(png.length >= 32);
    assert.equal(png.subarray(0, 4).toString("hex"), "89504e47");
    const image = decodePng(png);
    assertReceiptInkInContentBand(image.pixels, image.width, image.height);
  }
  assert.ok(preview.pages[0].ink.minY < 80);
});

test("injected queue and helper results stay offline, unsupported, or unknown", async () => {
  const readyDevice = {
    id: "USBPRINT\\XprinterXP-236B\\USB001",
    status: "OK",
  };
  const offline = await submitNativePrint(labelDispatch("بنطال تويل"), {
    platform: "win32",
    observations: {
      label: {
        found: true,
        driverName: "Xprinter XP-236B",
        workOffline: true,
        portName: "USB001",
        status: "normal",
        truncated: false,
        devices: [readyDevice],
      },
      receipt: {
        found: false,
        driverName: "",
        workOffline: false,
        portName: "",
        status: "",
        truncated: false,
        devices: [],
      },
    },
    runner: () => {
      throw new Error("print_not_allowed");
    },
  });
  assert.deepEqual(offline, { outcome: "failed", code: "printer_offline" });

  const wrong = await submitNativePrint(labelDispatch("بنطال تويل"), {
    platform: "win32",
    observations: {
      label: {
        found: true,
        driverName: "Other Driver",
        workOffline: false,
        portName: "USB001",
        status: "normal",
        truncated: false,
        devices: [readyDevice],
      },
      receipt: {
        found: false,
        driverName: "",
        workOffline: false,
        portName: "",
        status: "",
        truncated: false,
        devices: [],
      },
    },
  });
  assert.deepEqual(wrong, { outcome: "failed", code: "unsupported_driver" });

  let sawPrint = false;
  const unknown = await submitNativePrint(labelDispatch("بنطال تويل"), {
    platform: "win32",
    runner: async (run) => {
      sawPrint = run.action === "print";
      assert.equal(run.plan.shell, false);
      return { code: null, stdout: Buffer.alloc(0), timedOut: true, spawnError: false, overflow: false };
    },
  });
  assert.equal(sawPrint, true);
  assert.deepEqual(unknown, { outcome: "unknown" });

  const overflow = await submitNativePrint(labelDispatch("بنطال تويل"), {
    platform: "win32",
    runner: async () => ({ code: 0, stdout: Buffer.alloc(0), timedOut: false, spawnError: false, overflow: true }),
  });
  assert.deepEqual(overflow, { outcome: "unknown" });
});

const observedReceiptId = "USBPRINT\\PRINTERPOS-80\\6&CC95D4D&0&USB003";

function absentQueue() {
  return {
    found: false,
    driverName: "",
    workOffline: false,
    portName: "",
    status: "",
    truncated: false,
    devices: [],
  };
}

function observedReceiptQueue(overrides = {}) {
  return {
    found: true,
    driverName: "Xprinter XP-80",
    workOffline: false,
    portName: "USB003",
    status: "normal",
    truncated: false,
    devices: [{ id: observedReceiptId, status: "OK" }],
    ...overrides,
  };
}

test("PRINTERPOS-80 is a receipt-only alias and stays fail-closed", async () => {
  const ready = await probeNativePrinters({
    platform: "win32",
    observations: { label: absentQueue(), receipt: observedReceiptQueue() },
  });
  assert.equal(ready.ok, true);
  if (!ready.ok) return;
  assert.equal(ready.receipt, "ready");
  assert.equal(ready.label, "missing");

  const wrongPort = await probeNativePrinters({
    platform: "win32",
    observations: { label: absentQueue(), receipt: observedReceiptQueue({ portName: "USB001" }) },
  });
  assert.equal(wrongPort.ok, true);
  if (!wrongPort.ok) return;
  assert.equal(wrongPort.receipt, "offline");

  const notOk = await probeNativePrinters({
    platform: "win32",
    observations: {
      label: absentQueue(),
      receipt: observedReceiptQueue({ devices: [{ id: observedReceiptId, status: "Error" }] }),
    },
  });
  assert.equal(notOk.ok, true);
  if (!notOk.ok) return;
  assert.equal(notOk.receipt, "offline");

  const wrongDriver = await probeNativePrinters({
    platform: "win32",
    observations: {
      label: absentQueue(),
      receipt: observedReceiptQueue({ driverName: "Bravos Receipts - Xprinter XP-80TS" }),
    },
  });
  assert.equal(wrongDriver.ok, true);
  if (!wrongDriver.ok) return;
  assert.equal(wrongDriver.receipt, "unsupported");

  const asLabel = await probeNativePrinters({
    platform: "win32",
    observations: {
      label: {
        found: true,
        driverName: "Xprinter XP-236B",
        workOffline: false,
        portName: "USB003",
        status: "normal",
        truncated: false,
        devices: [{ id: observedReceiptId, status: "OK" }],
      },
      receipt: absentQueue(),
    },
  });
  assert.equal(asLabel.ok, true);
  if (!asLabel.ok) return;
  assert.equal(asLabel.label, "offline");
  assert.equal(asLabel.receipt, "missing");
});

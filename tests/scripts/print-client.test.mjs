import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LABEL_PRINTER_NAME, RECEIPT_PRINTER_NAME } from "../../packages/print-contracts/src/index.ts";
import {
  ConnectorClientError,
  pairDevice,
  PRINT_CONNECTOR_ORIGIN,
  PRINT_PAIRING_TOKEN_KEY,
  PRINT_WAIT_MESSAGE,
  readConnectorConnection,
  submitConnectorJob,
} from "../../apps/internal/src/printing/connector-client.ts";
import { buildReceiptView } from "../../apps/internal/src/receipts/receipt-model.ts";

function isRawSvgUrl(url) {
  const parsed = new URL(url);
  return parsed.protocol === "file:" && parsed.pathname.endsWith(".svg") && parsed.searchParams.has("raw");
}

const rawSvgHook = registerHooks({
  load(url, context, nextLoad) {
    if (!isRawSvgUrl(url)) return nextLoad(url, context);
    const fileUrl = new URL(url);
    fileUrl.search = "";
    fileUrl.hash = "";
    const svg = readFileSync(fileURLToPath(fileUrl));
    return {
      format: "module",
      source: `export default ${JSON.stringify(svg.toString("utf8"))};\n`,
      shortCircuit: true,
    };
  },
});

const { connectorLabelJob } = await import("../../apps/internal/src/labels/label-print.ts");
const { connectorReceiptJob } = await import("../../apps/internal/src/receipts/receipt-print.ts");
rawSvgHook.deregister();

const ORIGIN = "http://127.0.0.1:5177";
const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const OPERATION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SALE_ID = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function storage(seed = new Map()) {
  const blocked = new Set();
  return {
    blocked,
    getItem(key) {
      return seed.has(key) ? seed.get(key) : null;
    },
    setItem(key, value) {
      if (blocked.has(key)) throw new Error("quota");
      seed.set(key, value);
    },
    removeItem(key) {
      seed.delete(key);
    },
    seed,
  };
}

function deps(store, fetchImpl, extra = {}) {
  return { fetchImpl, storage: store, origin: ORIGIN, ...extra };
}

function statusBody(overrides = {}) {
  return {
    ok: true,
    paired: true,
    staffOrigin: ORIGIN,
    routing: { label: LABEL_PRINTER_NAME, receipt: RECEIPT_PRINTER_NAME },
    implementation: "windows_native",
    ...overrides,
  };
}

function jobMeta(phase, failureCode = null) {
  return {
    job: {
      id: JOB_ID,
      kind: "label",
      phase,
      failureCode,
      createdAt: "2026-10-27T00:00:00.000Z",
      updatedAt: "2026-10-27T00:00:00.000Z",
    },
  };
}

function labelJob() {
  return connectorLabelJob(
    { id: "product-1", code: "BRV-001", nameAr: "قميص" },
    { widthMm: 38, heightMm: 25, copies: 1, dpi: 203, profile: "xp236b-38x25" },
    JOB_ID,
  );
}

function sale(overrides = {}) {
  return {
    id: SALE_ID,
    reference: "POS-9",
    receiptReference: "BRV-7-12",
    operationId: OPERATION_ID,
    branch: { id: "branch-1", nameAr: "فرع مدينة نصر" },
    soldByStaffId: "staff-1",
    soldByDisplayName: "أمين الصندوق",
    occurredAt: "2026-01-15T22:30:00.000Z",
    recordedAt: null,
    customerName: "زبون",
    customerPhone: null,
    originalTotalPiasters: 30000,
    automaticOfferDiscountPiasters: 0,
    appliedAutomaticOffer: null,
    couponDiscountPiasters: 0,
    appliedCoupon: null,
    employeeDiscountPiasters: 0,
    discountReason: null,
    discountedByStaffId: null,
    finalTotalPiasters: 30000,
    exchangeCreditAppliedPiasters: 0,
    cashReceivedPiasters: 30000,
    payment: { method: "cash", cashPiasters: 30000, onlinePiasters: 0 },
    physicallyCompleted: true,
    discrepancy: null,
    lines: [{
      id: "line-1",
      variantId: "variant-1",
      quantity: 1,
      listedUnitPricePiasters: 30000,
      originalPiasters: 30000,
      discountPiasters: 0,
      paidPiasters: 30000,
      automaticOfferDiscountPiasters: 0,
      couponDiscountPiasters: 0,
      employeeDiscountPiasters: 0,
      allocatedQuantity: 1,
      unallocatedQuantity: 0,
      units: [],
      variant: {
        id: "variant-1",
        product: { id: "product-1", code: "BRV-001", nameAr: "قميص" },
        size: { id: "size-m", nameAr: "M" },
        color: { id: "color-black", nameAr: "أسود" },
      },
    }],
    ...overrides,
  };
}

test("pairing saves a 43-character token at the fixed pair URL and clears nothing else", async () => {
  assert.equal(TOKEN.length, 43);
  const store = storage();
  const calls = [];
  await pairDevice("  abcd2345efgh6789  ", {
    deps: deps(store, async (url, init) => {
      calls.push({ url, init, body: init.body });
      return new Response(JSON.stringify({ token: TOKEN }), { status: 200 });
    }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${PRINT_CONNECTOR_ORIGIN}/pair`);
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(JSON.parse(calls[0].body).code, "ABCD2345EFGH6789");
  assert.equal(store.seed.get(PRINT_PAIRING_TOKEN_KEY), TOKEN);
  assert.equal(calls[0].url.includes(TOKEN), false);
});

test("a failed token save revokes the new token and does not claim a second pair replaces it", async () => {
  const store = storage();
  store.blocked.add(PRINT_PAIRING_TOKEN_KEY);
  const calls = [];
  await assert.rejects(
    () => pairDevice("ABCD2345EFGH6789", {
      deps: deps(store, async (url, init) => {
        calls.push({ url, authorization: init.headers?.Authorization ?? init.headers?.authorization });
        if (url.endsWith("/pair")) return new Response(JSON.stringify({ token: TOKEN }), { status: 200 });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    }),
    (error) => {
      assert.equal(error instanceof ConnectorClientError, true);
      assert.equal(error.code, "storage");
      assert.match(error.message, /أُلغي الربط في برنامج الطباعة/);
      assert.equal(/يستبدل/.test(error.message), false);
      return true;
    },
  );
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ["/pair", "/unpair"]);
  assert.equal(calls[1].authorization, `Bearer ${TOKEN}`);
  assert.equal(store.seed.has(PRINT_PAIRING_TOKEN_KEY), false);

  const stranded = storage();
  stranded.blocked.add(PRINT_PAIRING_TOKEN_KEY);
  await assert.rejects(
    () => pairDevice("ABCD2345EFGH6789", {
      deps: deps(stranded, async (url) => {
        if (url.endsWith("/pair")) return new Response(JSON.stringify({ token: TOKEN }), { status: 200 });
        return new Response(JSON.stringify({ error: "offline" }), { status: 500 });
      }),
    }),
    (error) => {
      assert.match(error.message, /لا يستبدل ربطاً قائماً/);
      assert.match(error.message, /برنامج الطباعة/);
      return true;
    },
  );
});

test("status must match this page and the fixed routes before the device counts as paired", async () => {
  const store = storage(new Map([[PRINT_PAIRING_TOKEN_KEY, TOKEN]]));
  const ready = await readConnectorConnection({
    deps: deps(store, async () => new Response(JSON.stringify(statusBody()), { status: 200 })),
  });
  assert.equal(ready.state, "paired");
  assert.equal(ready.rendererReady, true);
  assert.equal(ready.labelPrinter, LABEL_PRINTER_NAME);
  assert.equal(store.seed.get(PRINT_PAIRING_TOKEN_KEY), TOKEN);

  const injected = await readConnectorConnection({
    deps: deps(store, async () => new Response(JSON.stringify(statusBody({ implementation: "injected" })), { status: 200 })),
  });
  assert.equal(injected.state, "paired");
  assert.equal(injected.rendererReady, true);

  const closed = await readConnectorConnection({
    deps: deps(store, async () => new Response(JSON.stringify(statusBody({ implementation: "windows_fail_closed" })), { status: 200 })),
  });
  assert.equal(closed.state, "paired");
  assert.equal(closed.rendererReady, false);

  const wrongOrigin = await readConnectorConnection({
    deps: deps(store, async () => new Response(JSON.stringify(statusBody({ staffOrigin: "http://127.0.0.1:5174" })), { status: 200 })),
  });
  assert.equal(wrongOrigin.state, "origin-mismatch");
  assert.equal(store.seed.get(PRINT_PAIRING_TOKEN_KEY), TOKEN);

  const bare = await readConnectorConnection({
    deps: deps(store, async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  });
  assert.equal(bare.state, "invalid-status");
  assert.equal(store.seed.get(PRINT_PAIRING_TOKEN_KEY), TOKEN);

  const missingOrigin = await readConnectorConnection({
    deps: deps(store, async () => new Response(JSON.stringify(statusBody({ staffOrigin: undefined })), { status: 200 })),
  });
  assert.equal(missingOrigin.state, "invalid-status");
  assert.equal(store.seed.get(PRINT_PAIRING_TOKEN_KEY), TOKEN);

  const malformed = await readConnectorConnection({
    deps: deps(store, async () => new Response(JSON.stringify(statusBody({ staffOrigin: 5173, paired: "true" })), { status: 200 })),
  });
  assert.equal(malformed.state, "invalid-status");
  assert.equal(store.seed.get(PRINT_PAIRING_TOKEN_KEY), TOKEN);

  const unknown = await readConnectorConnection({
    deps: deps(store, async () => new Response(JSON.stringify(statusBody({ implementation: "other" })), { status: 200 })),
  });
  assert.equal(unknown.state, "invalid-status");
  assert.equal(store.seed.get(PRINT_PAIRING_TOKEN_KEY), TOKEN);

  const unpaired = await readConnectorConnection({
    deps: deps(store, async () => new Response(JSON.stringify(statusBody({ paired: false })), { status: 200 })),
  });
  assert.equal(unpaired.state, "unpaired");
  assert.equal(store.seed.has(PRINT_PAIRING_TOKEN_KEY), false);
});

test("one accepted job is polled by the same id until submitted, with progress and no second POST", async () => {
  const store = storage(new Map([[PRINT_PAIRING_TOKEN_KEY, TOKEN]]));
  const calls = [];
  let now = 0;
  const progress = [];
  const result = await submitConnectorJob(labelJob(), {
    onProgress: (message) => progress.push(message),
    deps: deps(store, async (url, init) => {
      calls.push({ url, method: init.method, body: init.body });
      if (init.method === "POST") return new Response(JSON.stringify(jobMeta("queued")), { status: 202 });
      return new Response(JSON.stringify(jobMeta("submitted")), { status: 200 });
    }, {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      pollBudgetMs: 1_000,
      pollIntervalMs: 100,
    }),
  });
  assert.equal(result, "submitted");
  assert.deepEqual(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`), [
    "POST /jobs",
    "GET /jobs/" + JOB_ID,
  ]);
  assert.equal(progress[0], PRINT_WAIT_MESSAGE);
  assert.equal(JSON.parse(calls[0].body).kind, "label");
});

test("network loss after POST is uncertain and is not posted again", async () => {
  const store = storage(new Map([[PRINT_PAIRING_TOKEN_KEY, TOKEN]]));
  let posts = 0;
  await assert.rejects(
    () => submitConnectorJob(labelJob(), {
      deps: deps(store, async (_url, init) => {
        if (init.method === "POST") {
          posts += 1;
          throw new TypeError("failed");
        }
        throw new Error("unexpected");
      }),
    }),
    (error) => {
      assert.equal(error.code, "uncertain");
      assert.match(error.message, /لم يتأكد/);
      assert.equal(/لم يُرسل/.test(error.message), false);
      return true;
    },
  );
  assert.equal(posts, 1);
});

test("abort before POST does not send, and abort during POST does not send a second job", async () => {
  const store = storage(new Map([[PRINT_PAIRING_TOKEN_KEY, TOKEN]]));
  const early = new AbortController();
  early.abort();
  let posts = 0;
  await assert.rejects(
    () => submitConnectorJob(labelJob(), { signal: early.signal, deps: deps(store, async () => {
      posts += 1;
      return new Response("{}", { status: 500 });
    }) }),
    (error) => error.code === "aborted",
  );
  assert.equal(posts, 0);

  const late = new AbortController();
  await assert.rejects(
    () => submitConnectorJob(labelJob(), {
      signal: late.signal,
      deps: deps(store, async (_url, init) => {
        posts += 1;
        late.abort();
        throw new DOMException("aborted", "AbortError");
      }),
    }),
    (error) => error.code === "uncertain",
  );
  assert.equal(posts, 1);
});

test("explicit failure and unknown do not poll a new job or fall back", async () => {
  const store = storage(new Map([[PRINT_PAIRING_TOKEN_KEY, TOKEN]]));
  for (const [phase, code, failureCode] of [
    ["failed", "driver", "printer_offline"],
    ["unknown", "uncertain", "submission_uncertain"],
  ]) {
    const calls = [];
    await assert.rejects(
      () => submitConnectorJob(labelJob(), {
        deps: deps(store, async (url, init) => {
          calls.push(init.method);
          return new Response(JSON.stringify(jobMeta(phase, failureCode)), { status: 202 });
        }),
      }),
      (error) => error.code === code,
    );
    assert.deepEqual(calls, ["POST"]);
  }
  const journal = [];
  await assert.rejects(
    () => submitConnectorJob(labelJob(), {
      deps: deps(store, async (_url, init) => {
        journal.push(init.method);
        return new Response(JSON.stringify({ error: "journal_unavailable" }), { status: 500 });
      }),
    }),
    (error) => error.code === "journal",
  );
  assert.deepEqual(journal, ["POST"]);
});

test("receipt and label jobs stay apart, and a narrow receipt is refused before any request", () => {
  const label = labelJob();
  assert.equal(label.kind, "label");
  assert.equal(label.profile, "compact");
  assert.deepEqual(label.paper, { widthMm: 38, heightMm: 25 });
  assert.throws(
    () => connectorLabelJob(
      { id: "product-1", code: "BRV-001", nameAr: "قميص" },
      { widthMm: 90, heightMm: 50, copies: 1, dpi: 300, profile: "generic" },
      JOB_ID,
    ),
    /38×25/,
  );

  const view = buildReceiptView(sale(), { paperWidthMm: 80, contactPhone: "" });
  const receipt = connectorReceiptJob(view, JOB_ID);
  assert.equal(receipt.kind, "receipt");
  assert.equal(receipt.receiptView.printedReference, "BRV-7-12");
  assert.equal(receipt.receiptView.finalTotal, view.finalTotal);
  assert.equal(Object.hasOwn(receipt.receiptView, "serverReference"), false);
  assert.equal(Object.hasOwn(receipt.receiptView, "localOperationReference"), false);
  const packed = JSON.stringify(receipt);
  assert.equal(packed.includes(OPERATION_ID), false);
  assert.equal(packed.includes(SALE_ID), false);
  assert.equal(packed.includes("serverReference"), false);
  assert.throws(
    () => connectorReceiptJob(buildReceiptView(sale(), { paperWidthMm: 58, contactPhone: "" }), JOB_ID),
    /80/,
  );
});

test("the default fetch is called with the global receiver", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = function defaultFetch(url, init) {
    calls.push({ url, init, receiver: this });
    return Promise.resolve(new Response(JSON.stringify({ token: TOKEN }), { status: 200 }));
  };
  try {
    const store = storage();
    await pairDevice("ABCD2345EFGH6789", {
      deps: { storage: store, origin: ORIGIN },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].receiver, globalThis);
    assert.equal(calls[0].url, `${PRINT_CONNECTOR_ORIGIN}/pair`);
    assert.equal(calls[0].init.credentials, "omit");
    assert.equal(store.seed.get(PRINT_PAIRING_TOKEN_KEY), TOKEN);
  } finally {
    globalThis.fetch = previous;
  }
});

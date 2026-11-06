import assert from "node:assert/strict";
import test from "node:test";
import { parsePrintJob, QUEUE_CAP } from "../../packages/print-contracts/src/index.ts";
import { LABEL_PRINTER_NAME, RECEIPT_PRINTER_NAME } from "../../packages/print-contracts/src/index.ts";
import {
  injectedPort,
  jobId,
  labelJob,
  pairConnector,
  receiptJob,
  request,
  startConnector,
} from "./print-connector-harness.mjs";

async function pairedConnector(t, printPort, options = {}) {
  const connector = await startConnector({ printPort, ...options });
  t.after(() => connector.close());
  const paired = await pairConnector(connector);
  assert.equal(paired.status, 200);
  return { connector, token: paired.json.token };
}

test("labels and receipts keep names and prices and use only their allowlisted printers", async (t) => {
  const calls = [];
  const { connector, token } = await pairedConnector(t, injectedPort(async (dispatch) => {
    calls.push(dispatch);
    return { outcome: "submitted" };
  }));
  const label = await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(1), 2, "قميص قطن") });
  const receipt = await request(connector, { method: "POST", path: "/jobs", token, body: receiptJob(jobId(2)) });
  assert.equal(label.status, 202);
  assert.equal(receipt.status, 202);
  await connector.waitUntilIdle();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].printerName, LABEL_PRINTER_NAME);
  assert.equal(calls[0].kind, "label");
  assert.equal(calls[0].copies, 2);
  assert.equal(calls[0].document.product.name, "قميص قطن");
  assert.equal(calls[1].printerName, RECEIPT_PRINTER_NAME);
  assert.equal(calls[1].kind, "receipt");
  assert.equal(calls[1].copies, 1);
  assert.equal(calls[1].document.receiptView.lines[0].productName, "قميص قطن");
  assert.equal(calls[1].document.receiptView.lines[0].lineOriginal, "850");
  assert.equal(calls[1].document.receiptView.finalTotal, "800");
  assert.equal(calls.some((call) => call.kind === "label" && call.printerName === RECEIPT_PRINTER_NAME), false);
  assert.equal(connector.holdsDocument(jobId(1)), false);
  const fetched = await request(connector, { method: "GET", path: `/jobs/${jobId(1).toUpperCase()}`, token });
  assert.equal(fetched.json.job.phase, "submitted");
  assert.equal(fetched.text.includes("قميص"), false);
});

test("product-level receipts omit website options while keeping text validation and receipt routing", async (t) => {
  const calls = [];
  const { connector, token } = await pairedConnector(t, injectedPort(async (dispatch) => {
    calls.push(dispatch);
    return { outcome: "submitted" };
  }));
  const body = receiptJob(jobId(900));
  body.receiptView.lines[0].sizeName = "";
  body.receiptView.lines[0].colorName = "";
  assert.ok(parsePrintJob(body));
  for (const field of ["sizeName", "colorName"]) {
    for (const invalid of [null, 42, "x\u0000", "x\u202e", "x".repeat(81)]) {
      const malformed = structuredClone(body);
      malformed.receiptView.lines[0][field] = invalid;
      assert.equal(parsePrintJob(malformed), null);
    }
  }
  const response = await request(connector, { method: "POST", path: "/jobs", token, body });
  assert.equal(response.status, 202);
  await connector.waitUntilIdle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].printerName, RECEIPT_PRINTER_NAME);
  assert.equal(calls[0].document.receiptView.lines[0].sizeName, "");
  assert.equal(calls[0].document.receiptView.lines[0].colorName, "");
  assert.equal(calls[0].document.receiptView.finalTotal, "800");
});

test("the same job id and payload returns the same state and a different payload conflicts", async (t) => {
  const calls = [];
  const { connector, token } = await pairedConnector(t, injectedPort(async (dispatch) => {
    calls.push(dispatch);
    return { outcome: "submitted" };
  }));
  const first = await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(3), 4) });
  await connector.waitUntilIdle();
  const reordered = await request(connector, {
    method: "POST",
    path: "/jobs",
    token,
    raw: JSON.stringify({
      profile: "compact",
      dpi: 203,
      paper: { heightMm: 25, widthMm: 38 },
      product: { name: "قميص قطن", code: "SHIRT-1" },
      copies: 4,
      id: jobId(3),
      kind: "label",
    }),
  });
  const changed = await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(3), 5) });
  assert.equal(reordered.status, 202);
  assert.equal(reordered.json.job.phase, "submitted");
  assert.equal(changed.status, 409);
  assert.equal(changed.json.error, "job_conflict");
  assert.equal(calls.length, 1);
  assert.equal(first.json.job.id, jobId(3));
});

test("a deliberate reprint uses a new id after offline and unknown results, without retrying the old id", async (t) => {
  const calls = [];
  let mode = "offline";
  const { connector, token } = await pairedConnector(t, injectedPort(async (dispatch) => {
    calls.push(dispatch.jobId);
    if (mode === "throw") throw new Error("spooler disappeared");
    if (mode === "leaky") return { outcome: "submitted", leaked: "أحمد" };
    return { outcome: "failed", code: "printer_offline" };
  }));
  await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(4)) });
  await connector.waitUntilIdle();
  await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(4)) });
  await connector.waitUntilIdle();
  assert.deepEqual(calls, [jobId(4)]);
  const offline = await request(connector, { method: "GET", path: `/jobs/${jobId(4)}`, token });
  assert.equal(offline.json.job.phase, "failed");
  assert.equal(offline.json.job.failureCode, "printer_offline");

  mode = "throw";
  await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(5)) });
  await connector.waitUntilIdle();
  await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(5)) });
  const missingRetry = await request(connector, { method: "POST", path: `/jobs/${jobId(5)}/retry`, token, body: {} });
  assert.equal(missingRetry.status, 404);
  const unknown = await request(connector, { method: "GET", path: `/jobs/${jobId(5)}`, token });
  assert.equal(unknown.json.job.phase, "unknown");
  assert.equal(unknown.json.job.failureCode, "submission_uncertain");
  assert.equal(calls.filter((id) => id === jobId(5)).length, 1);

  mode = "leaky";
  await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(6)) });
  await connector.waitUntilIdle();
  const leaked = await request(connector, { method: "GET", path: `/jobs/${jobId(6)}`, token });
  assert.equal(leaked.json.job.phase, "unknown");
  assert.equal(JSON.stringify(connector.logs).includes("أحمد"), false);
  const reprint = await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(7)) });
  await connector.waitUntilIdle();
  assert.equal(reprint.status, 202);
  assert.equal(calls.filter((id) => id === jobId(7)).length, 1);
});

test("oversized, invalid, and wrong-copy jobs never reach the print port", async (t) => {
  const calls = [];
  const { connector, token } = await pairedConnector(t, injectedPort(async (dispatch) => {
    calls.push(dispatch);
    return { outcome: "submitted" };
  }));
  const oversized = await request(connector, {
    method: "POST",
    path: "/jobs",
    token,
    raw: Buffer.alloc(40_000, 0x61),
    contentType: "application/json",
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.json.error, "payload_too_large");
  const tooMany = labelJob(jobId(8), 101);
  const narrow = receiptJob(jobId(9));
  narrow.receiptView.contentWidthMm = 48;
  narrow.copies = 2;
  const html = labelJob(jobId(10));
  html.html = "<script>";
  const marked = labelJob(jobId(11), 1, "قميص (قطن) — diagnostic 😀");
  const accepted = await request(connector, { method: "POST", path: "/jobs", token, body: marked });
  assert.equal(accepted.status, 202);
  await connector.waitUntilIdle();
  assert.equal(calls.at(-1).document.product.name, "قميص (قطن) — diagnostic 😀");
  const traced = receiptJob(jobId(12), "أحمد <ضيف>، diagnostic");
  traced.receiptView.serverReference = "1042";
  traced.receiptView.localOperationReference = "عملية محلية 1";
  const controlled = labelJob(jobId(13), 1, "قميص\u202E");
  for (const body of [tooMany, narrow, html, { kind: "label", id: "not-a-uuid" }, traced, controlled]) {
    const response = await request(connector, { method: "POST", path: "/jobs", token, body });
    assert.equal(response.status, 400);
    assert.equal(response.json.error, "invalid_job");
  }
  assert.equal(parsePrintJob(narrow), null);
  assert.equal(parsePrintJob(traced), null);
  const rich = receiptJob(jobId(14), "أحمد (ضيف)، «عميل» 😀 <b>markup</b>");
  const richAccepted = await request(connector, { method: "POST", path: "/jobs", token, body: rich });
  assert.equal(richAccepted.status, 202);
  await connector.waitUntilIdle();
  assert.equal(calls.at(-1).document.receiptView.customerName, "أحمد (ضيف)، «عميل» 😀 <b>markup</b>");
  assert.equal(Object.hasOwn(calls.at(-1).document.receiptView, "serverReference"), false);
  assert.equal(Object.hasOwn(calls.at(-1).document.receiptView, "localOperationReference"), false);
  assert.equal(JSON.stringify(richAccepted.json).includes("serverReference"), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].document.product.name, "قميص (قطن) — diagnostic 😀");
});

test("the queue is serialized and capped, and a finished job does not consume the cap", async (t) => {
  let release = () => {};
  let gate = new Promise((resolve) => {
    release = resolve;
  });
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const { connector, token } = await pairedConnector(t, injectedPort(async (dispatch) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    calls.push(dispatch.jobId);
    await gate;
    active -= 1;
    return { outcome: "submitted" };
  }));
  for (let index = 1; index <= QUEUE_CAP; index += 1) {
    const response = await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(index)) });
    assert.equal(response.status, 202);
  }
  const blocked = await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(QUEUE_CAP + 1)) });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error, "queue_full");
  assert.equal(calls.length, 1);
  assert.equal(maxActive, 1);
  const status = await request(connector, { method: "GET", path: "/status", token });
  assert.equal(status.json.queue.outstanding, QUEUE_CAP);
  assert.equal(status.json.queue.cap, QUEUE_CAP);
  release();
  await connector.waitUntilIdle();
  assert.equal(calls.length, QUEUE_CAP);
  assert.equal(maxActive, 1);
  const after = await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(QUEUE_CAP + 1)) });
  await connector.waitUntilIdle();
  assert.equal(after.status, 202);
  assert.equal(calls.length, QUEUE_CAP + 1);
});

test("retention keeps the old id instead of printing a replacement when the record cap is full", async (t) => {
  const calls = [];
  const { connector, token } = await pairedConnector(
    t,
    injectedPort(async (dispatch) => {
      calls.push(dispatch.jobId);
      return { outcome: "submitted" };
    }),
    { metadataCap: 1 },
  );
  await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(30)) });
  await connector.waitUntilIdle();
  const retained = await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(31)) });
  const replay = await request(connector, { method: "POST", path: "/jobs", token, body: labelJob(jobId(30)) });
  assert.equal(retained.status, 429);
  assert.equal(retained.json.error, "job_retention_full");
  assert.equal(replay.status, 202);
  assert.equal(replay.json.job.phase, "submitted");
  assert.deepEqual(calls, [jobId(30)]);
});

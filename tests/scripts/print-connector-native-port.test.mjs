import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createWindowsPrintPort } from "../../apps/print-connector/src/adapters/windows-print-port.ts";
import { formatLocalNotice } from "../../apps/print-connector/src/compose.ts";
import {
  dispatchConnectorCommand,
  parseConnectorArgs,
  resetLocalPairing,
} from "../../apps/print-connector/src/local-reset.ts";
import { normalizePortResult } from "../../apps/print-connector/src/domain/print-result.ts";
import { LABEL_PRINTER_NAME, RECEIPT_PRINTER_NAME } from "../../packages/print-contracts/src/index.ts";
import { jobId, labelJob, receiptJob } from "./print-connector-harness.mjs";

function dispatch(document, kind, printerName, copies) {
  return { jobId: document.id, kind, printerName, copies, document };
}

test("importing composition does not submit, spawn, or load the native renderer", () => {
  const composeSource = readFileSync(new URL("../../apps/print-connector/src/compose.ts", import.meta.url), "utf8");
  const portSource = readFileSync(new URL("../../apps/print-connector/src/adapters/windows-print-port.ts", import.meta.url), "utf8");
  const resetSource = readFileSync(new URL("../../apps/print-connector/src/local-reset.ts", import.meta.url), "utf8");
  assert.equal(composeSource.includes("from \"./renderers/api.ts\""), false);
  assert.match(composeSource, /await import\("\.\/renderers\/api\.ts"\)/);
  assert.equal(portSource.includes("renderers/api"), false);
  assert.equal(portSource.includes("child_process"), false);
  assert.equal(resetSource.includes("child_process"), false);
  assert.equal(resetSource.includes("job-journal"), false);
  assert.equal(formatLocalNotice({ type: "pairing_code", code: "not a code", expiresAt: 1 }), null);
});

test("the default adapter never dispatches, even when a fake probe is ready", async () => {
  let probes = 0;
  let submits = 0;
  const port = createWindowsPrintPort({
    platform: "win32",
    probe: async () => {
      probes += 1;
      return "ready";
    },
    submitter: undefined,
  });
  const label = labelJob(jobId(1));
  assert.equal(port.describe().implementation, "windows_fail_closed");
  assert.deepEqual(
    await port.submit(dispatch(label, "label", LABEL_PRINTER_NAME, 1)),
    { outcome: "failed", code: "renderer_unavailable" },
  );
  assert.equal(probes, 1);
  assert.equal(submits, 0);
});

test("an explicit submitter receives only an allowlisted job", async () => {
  const seen = [];
  const port = createWindowsPrintPort({
    platform: "win32",
    submitter: async (job) => {
      seen.push(job);
      return { outcome: "submitted" };
    },
  });
  assert.equal(port.describe().implementation, "windows_native");
  const label = labelJob(jobId(2));
  const receipt = receiptJob(jobId(3));
  assert.deepEqual(await port.submit(dispatch(label, "label", LABEL_PRINTER_NAME, 1)), { outcome: "submitted" });
  assert.deepEqual(await port.submit(dispatch(receipt, "receipt", RECEIPT_PRINTER_NAME, 1)), { outcome: "submitted" });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].kind, "label");
  assert.equal(seen[0].printerName, LABEL_PRINTER_NAME);
  assert.equal(seen[0].copies, 1);
  assert.equal(seen[1].kind, "receipt");
  assert.equal(seen[1].printerName, RECEIPT_PRINTER_NAME);
  assert.equal(seen[1].copies, 1);

  const blocked = createWindowsPrintPort({
    platform: "linux",
    submitter: async () => {
      seen.push("platform");
      return { outcome: "submitted" };
    },
  });
  assert.deepEqual(
    await blocked.submit(dispatch(label, "label", LABEL_PRINTER_NAME, 1)),
    { outcome: "failed", code: "unsupported_platform" },
  );
  const mismatched = createWindowsPrintPort({
    platform: "win32",
    submitter: async () => {
      seen.push("mismatch");
      return { outcome: "submitted" };
    },
  });
  assert.deepEqual(
    await mismatched.submit(dispatch(label, "label", RECEIPT_PRINTER_NAME, 1)),
    { outcome: "failed", code: "unsupported_driver" },
  );
  assert.deepEqual(
    await mismatched.submit(dispatch(label, "label", LABEL_PRINTER_NAME, 0)),
    { outcome: "failed", code: "unsupported_driver" },
  );
  assert.deepEqual(
    await mismatched.submit(dispatch(receipt, "receipt", RECEIPT_PRINTER_NAME, 2)),
    { outcome: "failed", code: "unsupported_driver" },
  );
  assert.equal(seen.length, 2);
});

test("a thrown or uncertain native result stays unknown and invalid_layout is kept", async () => {
  const thrown = createWindowsPrintPort({
    platform: "win32",
    submitter: async () => {
      throw new Error("helper exited without a result");
    },
  });
  const label = labelJob(jobId(4));
  assert.deepEqual(
    await thrown.submit(dispatch(label, "label", LABEL_PRINTER_NAME, 1)),
    { outcome: "unknown" },
  );
  const uncertain = createWindowsPrintPort({
    platform: "win32",
    submitter: async () => ({ outcome: "failed", code: "disk_full", retry: true }),
  });
  assert.deepEqual(
    await uncertain.submit(dispatch(label, "label", LABEL_PRINTER_NAME, 1)),
    { outcome: "unknown" },
  );
  assert.deepEqual(normalizePortResult({ outcome: "unknown", retry: true }), { outcome: "unknown" });
  const layout = createWindowsPrintPort({
    platform: "win32",
    submitter: async () => ({ outcome: "failed", code: "invalid_layout" }),
  });
  assert.deepEqual(
    await layout.submit(dispatch(label, "label", LABEL_PRINTER_NAME, 1)),
    { outcome: "failed", code: "invalid_layout" },
  );
});

test("an offline receipt does not block a later label on the same port", async () => {
  const seen = [];
  const port = createWindowsPrintPort({
    platform: "win32",
    probe: async (printerName) => (printerName === RECEIPT_PRINTER_NAME ? "offline" : "ready"),
    submitter: async (job) => {
      seen.push(job.kind);
      return { outcome: "submitted" };
    },
  });
  const receipt = receiptJob(jobId(5));
  const label = labelJob(jobId(6));
  assert.deepEqual(
    await port.submit(dispatch(receipt, "receipt", RECEIPT_PRINTER_NAME, 1)),
    { outcome: "failed", code: "printer_offline" },
  );
  assert.deepEqual(
    await port.submit(dispatch(label, "label", LABEL_PRINTER_NAME, 1)),
    { outcome: "submitted" },
  );
  assert.deepEqual(seen, ["label"]);
});

test("local pairing reset refuses a running host and does not touch the journal or AppData", async () => {
  assert.equal(parseConnectorArgs([]), "start");
  assert.equal(parseConnectorArgs(["--reset-pairing"]), "reset-pairing");
  assert.throws(() => parseConnectorArgs(["--reset"]), /unknown_arguments/);
  assert.throws(() => parseConnectorArgs(["--reset-pairing", "--force"]), /unknown_arguments/);

  const journal = { loads: 0, saves: 0 };
  let cleared = 0;
  await assert.rejects(
    () => resetLocalPairing({
      platform: "win32",
      occupancy: async () => "owned",
      clearPairing: async () => {
        cleared += 1;
      },
    }),
    /connector_still_running/,
  );
  assert.equal(cleared, 0);
  assert.equal(journal.loads, 0);
  assert.equal(journal.saves, 0);

  await resetLocalPairing({
    platform: "win32",
    occupancy: async () => "free",
    clearPairing: async () => {
      cleared += 1;
    },
  });
  assert.equal(cleared, 1);
  assert.equal(journal.saves, 0);

  await assert.rejects(
    () => resetLocalPairing({
      platform: "linux",
      occupancy: async () => "free",
      clearPairing: async () => {
        cleared += 1;
      },
    }),
    /unsupported_platform/,
  );
  assert.equal(cleared, 1);

  let started = 0;
  let reset = 0;
  await dispatchConnectorCommand(["--nope"], {
    start: async () => {
      started += 1;
    },
    reset: async () => {
      reset += 1;
    },
  }).catch((error) => {
    assert.equal(error.message, "unknown_arguments");
  });
  assert.equal(started, 0);
  assert.equal(reset, 0);
});

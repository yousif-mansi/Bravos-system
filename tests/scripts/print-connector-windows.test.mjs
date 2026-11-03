import assert from "node:assert/strict";
import test from "node:test";
import { formatLocalNotice } from "../../apps/print-connector/src/compose.ts";
import { createWindowsPrintPort } from "../../apps/print-connector/src/adapters/windows-print-port.ts";
import {
  assertOwnedHelper,
  planOwnedHelperSpawn,
  windowsPowerShellPath,
} from "../../apps/print-connector/src/adapters/owned-helper.ts";
import {
  createWindowsDpapiTokenStore,
  pairingBlobPath,
} from "../../apps/print-connector/src/adapters/windows-dpapi-token-store.ts";
import {
  assertListenTarget,
  assertWindowsConnectorPlatform,
  productionListenTarget,
  readStaffOrigin,
} from "../../apps/print-connector/src/listen.ts";
import { LABEL_PRINTER_NAME, RECEIPT_PRINTER_NAME } from "../../packages/print-contracts/src/index.ts";
import { jobId, labelJob, pairConnector, request, STAFF_ORIGIN, startConnector } from "./print-connector-harness.mjs";

const HELPER = "C:\\repo\\apps\\print-connector\\helpers\\dpapi-current-user.ps1";

test("production listen and staff origin stay on the loopback allowlist", () => {
  assert.deepEqual(productionListenTarget(), { host: "127.0.0.1", port: 17831 });
  assertListenTarget("127.0.0.1", 17831, "production");
  assertListenTarget("127.0.0.1", 0, "ephemeral-test");
  assert.throws(() => assertListenTarget("0.0.0.0", 17831, "production"), /refusing_listen_host/);
  assert.throws(() => assertListenTarget("localhost", 17831, "production"), /refusing_listen_host/);
  assert.throws(() => assertListenTarget("127.0.0.1", 80, "production"), /refusing_listen_port/);
  assert.throws(() => assertListenTarget("127.0.0.1", 17831, "ephemeral-test"), /refusing_listen_port/);
  assert.throws(() => assertWindowsConnectorPlatform("linux"), /unsupported_platform/);
  assert.equal(readStaffOrigin(undefined), STAFF_ORIGIN);
  assert.equal(readStaffOrigin(""), STAFF_ORIGIN);
  assert.equal(readStaffOrigin("http://127.0.0.1:5178"), "http://127.0.0.1:5178");
  assert.throws(() => readStaffOrigin("https://127.0.0.1:5177"), /invalid_staff_origin/);
  assert.throws(() => readStaffOrigin("http://localhost:5177"), /invalid_staff_origin/);
  assert.throws(() => readStaffOrigin("http://127.0.0.1:17831"), /invalid_staff_origin/);
  assert.equal(formatLocalNotice({ type: "pairing_code", code: "ABCDEFGHJKLMNPQR", expiresAt: 1 })?.includes("ABCDEFGHJKLMNPQR"), true);
  assert.equal(formatLocalNotice({ type: "pairing_code", code: "not a code", expiresAt: 1 }), null);
});

test("the Windows print port fails closed and does not cross label and receipt queues", async () => {
  const linux = createWindowsPrintPort({ platform: "linux", probe: async () => "ready" });
  const blocked = await linux.submit({
    jobId: jobId(1),
    kind: "label",
    printerName: LABEL_PRINTER_NAME,
    copies: 1,
    document: labelJob(jobId(1)),
  });
  assert.deepEqual(blocked, { outcome: "failed", code: "unsupported_platform" });

  let probes = 0;
  const offline = createWindowsPrintPort({
    platform: "win32",
    probe: async () => {
      probes += 1;
      return "offline";
    },
  });
  const label = labelJob(jobId(2));
  assert.deepEqual(await offline.submit({
    jobId: label.id,
    kind: "label",
    printerName: LABEL_PRINTER_NAME,
    copies: 1,
    document: label,
  }), { outcome: "failed", code: "printer_offline" });
  assert.equal(probes, 1);
  assert.deepEqual(await offline.submit({
    jobId: label.id,
    kind: "label",
    printerName: RECEIPT_PRINTER_NAME,
    copies: 1,
    document: label,
  }), { outcome: "failed", code: "unsupported_driver" });
  assert.equal(probes, 1);

  const ready = createWindowsPrintPort({
    platform: "win32",
    probe: async () => "ready",
  });
  assert.deepEqual(await ready.submit({
    jobId: label.id,
    kind: "label",
    printerName: LABEL_PRINTER_NAME,
    copies: 1,
    document: label,
  }), { outcome: "failed", code: "renderer_unavailable" });
  const broken = createWindowsPrintPort({
    platform: "win32",
    probe: async () => {
      throw new Error("driver query failed");
    },
  });
  assert.deepEqual(await broken.submit({
    jobId: label.id,
    kind: "label",
    printerName: LABEL_PRINTER_NAME,
    copies: 1,
    document: label,
  }), { outcome: "failed", code: "unsupported_driver" });
});

test("an HTTP job through the Windows adapter is a definite failure and is not retried", async (t) => {
  const inner = createWindowsPrintPort({ platform: "win32" });
  let calls = 0;
  const connector = await startConnector({
    printPort: {
      describe: () => inner.describe(),
      submit: async (dispatch) => {
        calls += 1;
        return inner.submit(dispatch);
      },
    },
  });
  t.after(() => connector.close());
  const paired = await pairConnector(connector);
  await request(connector, { method: "POST", path: "/jobs", token: paired.json.token, body: labelJob(jobId(8), 1, "قميص قطن") });
  await connector.waitUntilIdle();
  await request(connector, { method: "POST", path: "/jobs", token: paired.json.token, body: labelJob(jobId(8), 1, "قميص قطن") });
  const failed = await request(connector, { method: "GET", path: `/jobs/${jobId(8)}`, token: paired.json.token });
  assert.equal(failed.json.job.phase, "failed");
  assert.equal(failed.json.job.failureCode, "renderer_unavailable");
  assert.equal(calls, 1);
  await request(connector, { method: "POST", path: "/jobs", token: paired.json.token, body: labelJob(jobId(9)) });
  await connector.waitUntilIdle();
  assert.equal(calls, 2);
  const status = await request(connector, { method: "GET", path: "/status", token: paired.json.token });
  assert.equal(status.json.implementation, "windows_fail_closed");
  assert.equal(status.json.routing.label, LABEL_PRINTER_NAME);
  assert.equal(status.json.routing.receipt, RECEIPT_PRINTER_NAME);
  assert.equal(JSON.stringify(connector.logs).includes("قميص"), false);
  assert.equal(connector.holdsDocument(jobId(8)), false);
});

test("DPAPI invocation keeps secrets off the command line and refuses other paths", async () => {
  assert.equal(
    windowsPowerShellPath("C:\\Windows"),
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  assert.equal(
    windowsPowerShellPath("C:\\WINDOWS"),
    "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  assert.equal(
    windowsPowerShellPath("C:\\windows"),
    "C:\\windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  assert.throws(() => windowsPowerShellPath("C:\\Windows\\System32"), /unsupported_system_root/);
  assert.throws(() => windowsPowerShellPath("C:\\Windows\\..\\Windows"), /unsupported_system_root/);
  assert.throws(() => windowsPowerShellPath("C:\\Windows\\System32\\cmd.exe"), /unsupported_system_root/);
  assert.throws(() => windowsPowerShellPath("C:\\WindowsExtra"), /unsupported_system_root/);
  assert.throws(() => assertOwnedHelper("C:\\Temp\\dpapi-current-user.ps1"), /refusing_helper_path/);
  assert.throws(() => pairingBlobPath("C:\\Users\\me\\..\\Windows"), /refusing_blob_path/);
  assert.throws(() => pairingBlobPath("\\\\server\\share"), /refusing_blob_path/);
  const blob = pairingBlobPath("C:\\Users\\me");
  assert.equal(blob, "C:\\Users\\me\\Bravos\\print-connector\\pairing.dpapi");

  const calls = [];
  const data = new Map();
  const removed = [];
  const files = {
    async read(file) {
      return data.has(file) ? data.get(file) : null;
    },
    async write(file, bytes) {
      data.set(file, Buffer.from(bytes));
    },
    async rename(from, to) {
      if (files.failRename) throw new Error("rename_failed");
      data.set(to, data.get(from));
      data.delete(from);
    },
    async remove(file) {
      removed.push(file);
      data.delete(file);
    },
    failRename: false,
  };
  const runner = async ({ plan, stdin }) => {
    calls.push({ plan, stdin: Buffer.from(stdin) });
    const message = JSON.parse(stdin.toString("utf8"));
    const payload = Buffer.from(message.payloadBase64, "base64");
    if (message.op === "protect") {
      return { code: 0, stdout: Buffer.from(Buffer.concat([Buffer.from("enc:"), payload]).toString("base64")) };
    }
    const text = payload.toString("utf8");
    if (!text.startsWith("enc:")) return { code: 1, stdout: Buffer.alloc(0) };
    return { code: 0, stdout: Buffer.from(Buffer.from(text.slice(4)).toString("base64")) };
  };
  const store = createWindowsDpapiTokenStore({
    platform: "win32",
    systemRoot: "C:\\Windows",
    localAppData: "C:\\Users\\me",
    helperPath: HELPER,
    runner,
    files,
  });
  assert.equal(await store.read(), null);
  assert.equal(calls.length, 0);
  const record = {
    version: 1,
    tokenSha256Hex: "ab".repeat(32),
    origin: STAFF_ORIGIN,
    pairedAt: "2026-10-31T00:00:00.000Z",
  };
  files.failRename = true;
  await assert.rejects(() => store.write(record), /rename_failed/);
  assert.equal(data.has(blob), false);
  assert.equal(removed.some((file) => file.endsWith(".partial")), true);
  files.failRename = false;
  await store.write(record);
  const plan = calls.at(-1).plan;
  assert.equal(plan.shell, false);
  assert.equal(plan.windowsHide, true);
  assert.equal(plan.file.endsWith("\\powershell.exe"), true);
  assert.deepEqual(plan.args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-File"]);
  const argv = plan.args.join(" ");
  assert.equal(argv.includes(record.tokenSha256Hex), false);
  assert.equal(argv.includes("payloadBase64"), false);
  const stored = data.get(blob);
  assert.equal(stored.toString("utf8").startsWith("enc:"), true);
  assert.notEqual(stored.toString("utf8"), JSON.stringify(record));
  assert.deepEqual(await store.read(), record);
  const linux = createWindowsDpapiTokenStore({ platform: "linux", runner, files });
  await assert.rejects(() => linux.read(), /unsupported_platform/);
});

test("the owned helper planner matches the fixed script and not an injected print command", () => {
  const plan = planOwnedHelperSpawn({ systemRoot: "C:\\Windows", helperPath: HELPER });
  assert.equal(plan.shell, false);
  assert.equal(plan.args.includes("-Command"), false);
  assert.equal(plan.args.at(-1)?.endsWith("\\dpapi-current-user.ps1"), true);
});

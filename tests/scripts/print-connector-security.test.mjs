import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryTokenStore } from "../../apps/print-connector/src/adapters/memory-token-store.ts";
import { formatSanitizedLine } from "../../apps/print-connector/src/adapters/sanitized-log.ts";
import { sha256Hex } from "../../apps/print-connector/src/token-hash.ts";
import {
  PAIRING_LOCK_MS,
  PAIRING_TTL_MS,
} from "../../packages/print-contracts/src/index.ts";
import {
  clock,
  injectedPort,
  jobId,
  labelJob,
  pairConnector,
  receiptJob,
  request,
  STAFF_ORIGIN,
  startConnector,
} from "./print-connector-harness.mjs";

async function open(t, options = {}) {
  const connector = await startConnector({
    printPort: options.printPort ?? injectedPort(async () => ({ outcome: "submitted" })),
    ...(options.now ? { now: options.now } : {}),
    ...(options.tokenStore ? { tokenStore: options.tokenStore } : {}),
  });
  t.after(() => connector.close());
  return connector;
}

test("health is minimal and protected routes reject a foreign host and origin", async (t) => {
  const connector = await open(t);
  const health = await request(connector, { method: "GET", path: "/health", origin: null });
  assert.deepEqual(health.json, { ok: true });
  assert.equal(health.headers["access-control-allow-origin"], undefined);

  const trustedHealth = await request(connector, { method: "GET", path: "/health" });
  assert.equal(trustedHealth.headers["access-control-allow-origin"], STAFF_ORIGIN);
  assert.equal(trustedHealth.headers["access-control-allow-credentials"], undefined);
  assert.equal(trustedHealth.text.includes("*"), false);

  const host = await request(connector, {
    method: "GET",
    path: "/health",
    origin: null,
    host: `localhost:${connector.port}`,
  });
  assert.equal(host.status, 403);
  assert.equal(host.json.error, "invalid_host");
  assert.equal(host.headers["access-control-allow-origin"], undefined);

  const origin = await request(connector, {
    method: "POST",
    path: "/pair",
    origin: "http://127.0.0.1:5999",
    body: { code: "ABCDEFGHJKLMNPQR" },
  });
  assert.equal(origin.status, 403);
  assert.equal(origin.json.error, "invalid_origin");
  assert.equal(origin.text.includes("token"), false);

  const missing = await request(connector, { method: "POST", path: "/jobs", origin: null, body: labelJob(jobId(1)) });
  assert.equal(missing.status, 403);
  assert.equal(missing.json.error, "invalid_origin");
});

test("private-network preflight is exact for the staff origin and refuses other origins", async (t) => {
  const connector = await open(t);
  const trusted = await request(connector, {
    method: "OPTIONS",
    path: "/jobs",
    headers: {
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Authorization, Content-Type",
      "Access-Control-Request-Private-Network": "true",
    },
  });
  assert.equal(trusted.status, 204);
  assert.equal(trusted.headers["access-control-allow-origin"], STAFF_ORIGIN);
  assert.equal(trusted.headers["access-control-allow-private-network"], "true");
  assert.equal(trusted.headers["access-control-allow-methods"], "GET, POST, OPTIONS");
  assert.notEqual(trusted.headers["access-control-allow-origin"], "*");

  const noPrivate = await request(connector, {
    method: "OPTIONS",
    path: "/jobs",
    headers: { "Access-Control-Request-Method": "POST" },
  });
  assert.equal(noPrivate.status, 204);
  assert.equal(noPrivate.headers["access-control-allow-private-network"], undefined);

  const evil = await request(connector, {
    method: "OPTIONS",
    path: "/jobs",
    origin: "https://evil.example",
    headers: {
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Private-Network": "true",
    },
  });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers["access-control-allow-origin"], undefined);
  assert.equal(evil.headers["access-control-allow-private-network"], undefined);

  const scriptHeader = await request(connector, {
    method: "OPTIONS",
    path: "/jobs",
    headers: {
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "X-Inject",
    },
  });
  assert.equal(scriptHeader.status, 403);
});

test("pairing code is local, single-use, expiring, and rate-limited", async (t) => {
  const time = clock(1_000_000);
  const connector = await open(t, { now: time.now });
  const code = connector.notices[0]?.code;
  assert.equal(typeof code, "string");
  assert.equal(code.length, 16);

  const bootstrap = await request(connector, { method: "GET", path: "/pair" });
  assert.equal(bootstrap.status, 405);
  assert.equal(bootstrap.text.includes(code), false);
  assert.equal(bootstrap.text.includes("token"), false);

  const missingCode = await request(connector, { method: "POST", path: "/pair", body: {} });
  assert.equal(missingCode.status, 400);
  assert.equal(missingCode.text.includes("token"), false);

  const raced = await Promise.all([pairConnector(connector, code), pairConnector(connector, code)]);
  assert.equal(raced.filter((item) => item.status === 200).length, 1);
  assert.equal(raced.filter((item) => item.status === 401).length, 1);
  const paired = raced.find((item) => item.status === 200);
  assert.equal(typeof paired.json.token, "string");
  assert.equal(paired.json.token.length, 43);
  assert.equal(JSON.stringify(connector.logs).includes(paired.json.token), false);
  assert.equal(JSON.stringify(connector.logs).includes(code), false);
  const again = await pairConnector(connector, code);
  assert.equal(again.status, 401);
  assert.equal(again.json.token, undefined);

  const status = await request(connector, { method: "GET", path: "/status", token: paired.json.token });
  assert.equal(status.status, 200);
  assert.equal(status.json.paired, true);
  assert.equal(status.text.includes(paired.json.token), false);
  assert.equal(status.text.includes(code), false);
  const snapshot = connector.tokenStore.snapshot();
  assert.equal(snapshot.origin, STAFF_ORIGIN);
  assert.equal(JSON.stringify(snapshot).includes(paired.json.token), false);

  const unbound = await request(connector, {
    method: "GET",
    path: "/status",
    origin: "http://localhost:5177",
    token: paired.json.token,
  });
  assert.equal(unbound.status, 403);
});

test("a wrong pairing code locks and an expired code is replaced only on the local notice", async (t) => {
  const time = clock(5_000);
  const connector = await open(t, { now: time.now });
  const first = connector.notices[0].code;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await pairConnector(connector, "ZZZZZZZZZZZZZZZZ");
    if (attempt < 5) {
      assert.equal(response.status, 401);
      assert.equal(response.json.error, "pairing_invalid");
    } else {
      assert.equal(response.status, 429);
      assert.equal(response.json.error, "pairing_rate_limited");
    }
  }
  const stillLocked = await pairConnector(connector, first);
  assert.equal(stillLocked.status, 429);
  time.advance(PAIRING_LOCK_MS);
  const afterLock = await pairConnector(connector, first);
  assert.equal(afterLock.status, 200);

  const second = await startConnector({
    printPort: injectedPort(async () => ({ outcome: "submitted" })),
    now: time.now,
  });
  t.after(() => second.close());
  const stale = second.notices[0].code;
  time.advance(PAIRING_TTL_MS + 1);
  const expired = await pairConnector(second, stale);
  assert.equal(expired.status, 401);
  assert.equal(expired.json.error, "pairing_expired");
  assert.equal(expired.text.includes("token"), false);
  const replacement = second.notices.at(-1).code;
  assert.notEqual(replacement, stale);
  assert.equal(JSON.stringify(second.logs).includes(replacement), false);
  const renewed = await pairConnector(second, replacement);
  assert.equal(renewed.status, 200);
});

test("a stored token is bound to the configured origin and is dropped when that origin differs", async (t) => {
  const token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const store = createMemoryTokenStore({
    version: 1,
    tokenSha256Hex: sha256Hex(token),
    origin: "http://127.0.0.1:5999",
    pairedAt: "2026-10-31T00:00:00.000Z",
  });
  const connector = await open(t, { tokenStore: store });
  assert.equal(store.snapshot(), null);
  assert.equal(typeof connector.notices[0]?.code, "string");
  const rejected = await request(connector, { method: "GET", path: "/status", token });
  assert.equal(rejected.status, 401);
});

test("sanitized logs and job responses omit customer text, codes, and tokens", async (t) => {
  const calls = [];
  const connector = await open(t, {
    printPort: injectedPort(async (dispatch) => {
      calls.push(dispatch);
      return { outcome: "submitted" };
    }),
  });
  const paired = await pairConnector(connector);
  const posted = await request(connector, {
    method: "POST",
    path: "/jobs",
    token: paired.json.token,
    body: receiptJob(jobId(7), "أحمد"),
  });
  assert.equal(posted.status, 202);
  await connector.waitUntilIdle();
  const body = `${posted.text}\n${JSON.stringify(connector.logs)}\n${JSON.stringify(await request(connector, { method: "GET", path: "/health", origin: null }).then((item) => item.json))}`;
  assert.equal(body.includes("أحمد"), false);
  assert.equal(body.includes(paired.json.token), false);
  assert.equal(body.includes(connector.notices[0].code), false);
  assert.equal(calls[0].document.receiptView.customerName, "أحمد");
  assert.equal(calls[0].document.receiptView.finalTotal, "800");
  const line = formatSanitizedLine({
    event: "job_finished",
    httpStatus: null,
    jobId: jobId(7),
    kind: "receipt",
    phase: "submitted",
    failureCode: null,
    error: null,
    customerName: "أحمد",
    token: paired.json.token,
  });
  assert.equal(line.includes("أحمد"), false);
  assert.equal(line.includes(paired.json.token), false);
});

test("unpair requires the bearer token and the old token dies", async (t) => {
  const connector = await open(t);
  const paired = await pairConnector(connector);
  const anonymous = await request(connector, { method: "POST", path: "/unpair" });
  assert.equal(anonymous.status, 401);
  const cleared = await request(connector, { method: "POST", path: "/unpair", token: paired.json.token });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.json, { ok: true });
  const stale = await request(connector, { method: "GET", path: "/status", token: paired.json.token });
  assert.equal(stale.status, 401);
  assert.notEqual(connector.notices.at(-1).code, connector.notices[0].code);
});

test("query strings and label payloads with purchase cost are refused before printing", async (t) => {
  const calls = [];
  const connector = await open(t, {
    printPort: injectedPort(async (dispatch) => {
      calls.push(dispatch);
      return { outcome: "submitted" };
    }),
  });
  const paired = await pairConnector(connector);
  const query = await request(connector, { method: "GET", path: "/health?token=secret", origin: null });
  assert.equal(query.status, 400);
  const poisoned = labelJob(jobId(3));
  poisoned.purchaseCost = "10";
  const response = await request(connector, { method: "POST", path: "/jobs", token: paired.json.token, body: poisoned });
  assert.equal(response.status, 400);
  assert.equal(response.json.error, "invalid_job");
  assert.equal(calls.length, 0);
});

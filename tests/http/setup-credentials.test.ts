import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";
import {
  recordVerifiedSetupCredentials,
  type PreviousSetupCredentials,
} from "../../scripts/setup-credentials.ts";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";

let cluster: PostgresCluster;
let built: BuiltApp;
let outboxDir: string;
let credentialsPath: string;

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55437 });
}, 120_000);

afterAll(async () => {
  if (built) {
    await built.close();
  }
  await cluster.stop();
});

beforeEach(async () => {
  if (built) {
    await built.close();
  }
  const databaseName = `bravos_setup_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  outboxDir = await mkdtemp(path.join(tmpdir(), "bravos-setup-outbox-"));
  credentialsPath = path.join(await mkdtemp(path.join(tmpdir(), "bravos-creds-")), "demo-credentials.txt");
  built = await buildApp({
    nodeEnv: "test",
    databaseUrl: cluster.connectionString(databaseName),
    authSecret: "setup-secret-setup-secret-setup-secret32",
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: INTERNAL_ORIGIN,
    publicOrigin: PUBLIC_ORIGIN,
    trustedOrigins: [INTERNAL_ORIGIN, "http://127.0.0.1:3010"],
    secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: outboxDir,
  });
  await ensureOwner(built.services, {
    loginName: "owner",
    displayName: "مالك برافوس",
    password: "owner-pass-1",
  });
});

test("repeated setup records a verified preserved password for the same login", async () => {
  const previous: PreviousSetupCredentials = {
    ownerLogin: "owner",
    ownerPassword: "owner-pass-1",
    cashierLogin: "cashier",
    cashierPassword: undefined,
  };
  const recorded = await recordVerifiedSetupCredentials({
    app: built.app,
    origin: INTERNAL_ORIGIN,
    credentialsPath,
    ownerLogin: "owner",
    cashierLogin: "cashier",
    ownerCreated: false,
    cashierCreated: false,
    suppliedOwnerPassword: undefined,
    suppliedCashierPassword: undefined,
    previous,
  });
  expect(recorded.ownerPassword).toBe("owner-pass-1");
  expect(recorded.ownerPasswordState).toBe("verified");
  const text = await readFile(credentialsPath, "utf8");
  expect(text).toContain("owner login: owner");
  expect(text).toMatch(/owner password: owner-pass-1/);
  expect(text).toMatch(/demo cashier password: unknown/);
});

test("a supplied password is not recorded unless it actually signs in", async () => {
  await expect(
    recordVerifiedSetupCredentials({
      app: built.app,
      origin: INTERNAL_ORIGIN,
      credentialsPath,
      ownerLogin: "owner",
      cashierLogin: "cashier",
      ownerCreated: false,
      cashierCreated: false,
      suppliedOwnerPassword: "wrong-owner-pass",
      suppliedCashierPassword: undefined,
      previous: {
        ownerLogin: "owner",
        ownerPassword: "owner-pass-1",
        cashierLogin: "cashier",
        cashierPassword: undefined,
      },
    }),
  ).rejects.toThrow(/does not match the existing owner/i);
  await expect(readFile(credentialsPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

test("an origin denial does not treat a preserved password as invalid or rewrite the credentials file", async () => {
  const existing = [
    "BRAVOS labeled local demo credentials. Disposable. Do not use in production.",
    "owner login: owner",
    "owner password: owner-pass-1",
    "demo cashier login: cashier",
    "demo cashier password: cashier-pass-1",
    "branches: أبشواي، الفيوم",
    "",
  ].join("\n");
  await writeFile(credentialsPath, existing, "utf8");

  await expect(
    recordVerifiedSetupCredentials({
      app: built.app,
      origin: "http://evil.example",
      credentialsPath,
      ownerLogin: "owner",
      cashierLogin: "cashier",
      ownerCreated: false,
      cashierCreated: false,
      suppliedOwnerPassword: undefined,
      suppliedCashierPassword: undefined,
      previous: {
        ownerLogin: "owner",
        ownerPassword: "owner-pass-1",
        cashierLogin: "cashier",
        cashierPassword: "cashier-pass-1",
      },
    }),
  ).rejects.toThrow(/could not verify owner credentials: unexpected status 403 \(ORIGIN_DENIED\)/i);

  expect(await readFile(credentialsPath, "utf8")).toBe(existing);
});

test("a changed login name does not inherit another account's preserved password", async () => {
  const recorded = await recordVerifiedSetupCredentials({
    app: built.app,
    origin: INTERNAL_ORIGIN,
    credentialsPath,
    ownerLogin: "owner",
    cashierLogin: "new.cashier",
    ownerCreated: false,
    cashierCreated: false,
    suppliedOwnerPassword: undefined,
    suppliedCashierPassword: undefined,
    previous: {
      ownerLogin: "owner",
      ownerPassword: "owner-pass-1",
      cashierLogin: "old.cashier",
      cashierPassword: "old-cashier-pass",
    },
  });
  expect(recorded.cashierPasswordState).toBe("unknown");
  expect(recorded.cashierPassword).toBeUndefined();
  const text = await readFile(credentialsPath, "utf8");
  expect(text).toContain("demo cashier login: new.cashier");
  expect(text).toMatch(/demo cashier password: unknown/);
  expect(text).not.toContain("old-cashier-pass");
});

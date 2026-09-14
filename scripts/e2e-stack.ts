import { mkdir } from "node:fs/promises";
import path from "node:path";
import { startPostgresCluster } from "@bravos/testkit";
import { DuplicateLoginNameError } from "@bravos/identity";
import { buildApp } from "../apps/api/src/app.ts";
import { ensureOwner } from "../apps/api/src/bootstrap.ts";

const outboxDir = path.resolve(".local/e2e-outbox");
await mkdir(outboxDir, { recursive: true });
console.log("e2e: starting postgres");
const cluster = await startPostgresCluster({ port: 55433 });
await cluster.createDatabase("bravos_e2e");
console.log("e2e: building API");
const built = await buildApp({
  nodeEnv: "test",
  databaseUrl: cluster.connectionString("bravos_e2e"),
  authSecret: "e2e-secret-e2e-secret-e2e-secret-32aa",
  authBaseUrl: "http://127.0.0.1:3011",
  internalOrigin: "http://127.0.0.1:5174",
  publicOrigin: "http://127.0.0.1:3001",
  trustedOrigins: ["http://127.0.0.1:5174", "http://127.0.0.1:5175", "http://127.0.0.1:5176", "http://127.0.0.1:3011"],
  secureCookies: false,
  ownerRecoveryAdapter: "local-outbox",
  ownerRecoveryOutboxDir: outboxDir,
});
try {
  await ensureOwner(built.services, {
    loginName: "owner",
    displayName: "مالك برافوس",
    password: "e2e-owner-pass",
  });
} catch (error) {
  if (!(error instanceof DuplicateLoginNameError)) {
    throw error;
  }
}
const branches = await built.pool.query<{ id: string; code: string }>("SELECT id, code FROM branch");
const abshwayId = branches.rows.find((row) => row.code === "abshway")?.id;
if (!abshwayId) {
  throw new Error("Abshway is required for e2e.");
}
try {
  await built.services.createStaffRecord(
    {
      loginName: "cashier",
      displayName: "كاشير تجريبي",
      password: "e2e-cashier-pass",
      role: "employee",
      grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
    },
    { isOwner: false, role: "employee", actorStaffId: null },
  );
} catch (error) {
  if (!(error instanceof DuplicateLoginNameError)) {
    throw error;
  }
}
try {
  await built.services.createStaffRecord(
    {
      loginName: "cashier-b",
      displayName: "كاشير ثان",
      password: "e2e-cashier-b-pass",
      role: "employee",
      grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
    },
    { isOwner: false, role: "employee", actorStaffId: null },
  );
} catch (error) {
  if (!(error instanceof DuplicateLoginNameError)) {
    throw error;
  }
}

await built.app.listen({ port: 3011, host: "127.0.0.1" });
console.log("e2e API listening on http://127.0.0.1:3011");

const stop = async () => {
  try {
    await built.close();
  } finally {
    await cluster.stop();
    process.exit(0);
  }
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

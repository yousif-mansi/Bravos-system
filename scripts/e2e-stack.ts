import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { DuplicateLoginNameError } from "@bravos/identity";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";
import { buildApp } from "../apps/api/src/app.ts";
import { ensureOwner } from "../apps/api/src/bootstrap.ts";

const outboxDir = path.resolve(".local/e2e-outbox");
const productMediaDir = path.resolve(".local/e2e-product-media");
const localDir = path.resolve(".local");
const configuredControlFile = process.env.BRAVOS_E2E_CONTROL_FILE;
if (!configuredControlFile) {
  throw new Error("BRAVOS_E2E_CONTROL_FILE is required.");
}
const controlFile = path.resolve(configuredControlFile);
if (path.dirname(controlFile) !== localDir) {
  throw new Error("BRAVOS_E2E_CONTROL_FILE must be a direct child of the workspace .local directory.");
}

type BuiltApp = Awaited<ReturnType<typeof buildApp>>;

const catalogStarts = new Map<string, number>();

function isPublicCatalogRequest(url: string): boolean {
  return (url.split("?", 1)[0] ?? url) === "/api/public/storefront/catalog";
}

function poolCounts(pool: BuiltApp["pool"]): { waiting: number; idle: number; total: number } {
  return { waiting: pool.waitingCount, idle: pool.idleCount, total: pool.totalCount };
}

function registerCatalogTiming(appBuilt: BuiltApp): void {
  appBuilt.app.addHook("onRequest", (request, _reply, done) => {
    if (!isPublicCatalogRequest(request.url)) {
      done();
      return;
    }
    catalogStarts.set(request.id, performance.now());
    console.log(`e2e:catalog-timing ${JSON.stringify({
      event: "start",
      id: request.id,
      url: request.url,
      pool: poolCounts(appBuilt.pool),
    })}`);
    done();
  });

  appBuilt.app.addHook("onResponse", (request, reply, done) => {
    if (!isPublicCatalogRequest(request.url)) {
      done();
      return;
    }
    const startedAt = catalogStarts.get(request.id);
    catalogStarts.delete(request.id);
    console.log(`e2e:catalog-timing ${JSON.stringify({
      event: "end",
      id: request.id,
      url: request.url,
      statusCode: reply.statusCode,
      elapsedMs: startedAt === undefined ? null : Math.round(performance.now() - startedAt),
      pool: poolCounts(appBuilt.pool),
    })}`);
    done();
  });
}

let cluster: PostgresCluster | undefined;
let built: BuiltApp | undefined;
let controlServer: Server | undefined;
let stopPromise: Promise<void> | undefined;

function stopResources(): Promise<void> {
  stopPromise ??= (async () => {
    const errors: unknown[] = [];
    try {
      await built?.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      await cluster?.stop();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, "Failed to stop the e2e API and PostgreSQL cluster.");
    }
  })();
  return stopPromise;
}

async function removeControlFile(): Promise<void> {
  await rm(controlFile, { force: true });
}

async function closeControlServer(): Promise<void> {
  const server = controlServer;
  controlServer = undefined;
  if (!server?.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function authorized(value: string | undefined, token: string): boolean {
  if (!value) {
    return false;
  }
  const actual = Buffer.from(value);
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function startControlServer(): Promise<void> {
  const token = randomBytes(32).toString("hex");
  controlServer = createServer((request, response) => {
    const loopback = request.socket.remoteAddress === "127.0.0.1" || request.socket.remoteAddress === "::1";
    if (!loopback || request.method !== "POST" || request.url !== "/shutdown") {
      response.writeHead(404).end();
      return;
    }
    if (!authorized(request.headers.authorization, token)) {
      response.writeHead(401).end();
      return;
    }

    void (async () => {
      try {
        await stopResources();
        response.once("finish", () => {
          void (async () => {
            await closeControlServer();
            await removeControlFile();
          })().catch((error) => {
            console.error("e2e: failed to finalize control server shutdown", error);
            process.exitCode = 1;
          });
        });
        response.writeHead(200, { "content-type": "application/json", connection: "close" });
        response.end(JSON.stringify({ stopped: true }));
      } catch (error) {
        console.error("e2e: graceful shutdown failed", error);
        response.writeHead(500, { "content-type": "application/json", connection: "close" });
        response.end(JSON.stringify({ stopped: false }));
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    controlServer!.once("error", reject);
    controlServer!.listen(0, "127.0.0.1", () => {
      controlServer!.off("error", reject);
      resolve();
    });
  });
  const address = controlServer.address();
  if (!address || typeof address === "string") {
    throw new Error("The e2e control server did not bind a TCP port.");
  }

  await mkdir(localDir, { recursive: true });
  const temporaryControlFile = `${controlFile}.${process.pid}.tmp`;
  try {
    await writeFile(
      temporaryControlFile,
      JSON.stringify({ version: 1, port: address.port, token, apiPort: 3011, databasePort: 55433 }),
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporaryControlFile, controlFile);
  } finally {
    await rm(temporaryControlFile, { force: true });
  }
}

async function main(): Promise<void> {
  await mkdir(outboxDir, { recursive: true });
  console.log("e2e: starting postgres");
  try {
    cluster = await startPostgresCluster({ port: 55433 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("e2e: postgres failed before the cluster was ready");
    console.error(message);
    throw error;
  }
  await cluster.createDatabase("bravos_e2e");
  console.log("e2e: building API");
  built = await buildApp({
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
    productMediaDir,
  });
  registerCatalogTiming(built);
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
  await startControlServer();
  console.log("e2e API listening on http://127.0.0.1:3011");
}

async function stopFromSignal(): Promise<void> {
  try {
    await stopResources();
    await closeControlServer();
    await removeControlFile();
  } catch (error) {
    console.error("e2e: signal shutdown failed", error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void stopFromSignal());
process.once("SIGTERM", () => void stopFromSignal());

try {
  await main();
} catch (error) {
  try {
    await stopResources();
    await closeControlServer();
    await removeControlFile();
  } catch (cleanupError) {
    console.error("e2e: startup cleanup failed", cleanupError);
  }
  throw error;
}

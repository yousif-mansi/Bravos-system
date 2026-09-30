import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { startPostgresCluster } from "@bravos/testkit";
import { DuplicateLoginNameError } from "@bravos/identity";
import { buildApp, type BuiltApp } from "../apps/api/src/app.ts";
import { ensureOwner } from "../apps/api/src/bootstrap.ts";
import type { PostgresCluster } from "@bravos/testkit";
import { recordVerifiedSetupCredentials } from "./setup-credentials.ts";

if (process.env.NODE_ENV === "production") {
  throw new Error("Local labeled setup refuses to run in production.");
}

// Isolated verification of this script only. postgres:dev and the API env loader stay on .local unless their own overrides are set.
const setupRoot = path.resolve(process.env.BRAVOS_SETUP_ROOT ?? ".local");
const dataDir = path.join(setupRoot, "postgres");
const outboxDir = path.join(setupRoot, "owner-recovery-outbox");
const productMediaDir = path.join(setupRoot, "product-media");
const credentialsPath = path.join(setupRoot, "demo-credentials.txt");
const envPath = path.join(setupRoot, "dev.env");
const databaseName = process.env.BRAVOS_SETUP_DATABASE_NAME ?? "bravos";
if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) {
  throw new Error("BRAVOS_SETUP_DATABASE_NAME must be 1–63 lowercase letters, digits, or underscores, starting with a letter.");
}

let cluster: PostgresCluster | undefined;
let built: BuiltApp | undefined;

try {
  cluster = await startPostgresCluster({
    port: Number(process.env.BRAVOS_PG_PORT ?? 54329),
    persistentDir: dataDir,
  });
  try {
    await cluster.createDatabase(databaseName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(message)) {
      throw error;
    }
  }

  const databaseUrl = cluster.connectionString(databaseName);
  const config = {
    nodeEnv: "development",
    databaseUrl,
    authSecret: process.env.BETTER_AUTH_SECRET ?? "local-dev-secret-local-dev-secret-32",
    authBaseUrl: process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3010",
    internalOrigin: process.env.BRAVOS_INTERNAL_ORIGIN ?? "http://127.0.0.1:5173",
    publicOrigin: process.env.BRAVOS_PUBLIC_ORIGIN ?? "http://127.0.0.1:3000",
    trustedOrigins: [
      process.env.BRAVOS_INTERNAL_ORIGIN ?? "http://127.0.0.1:5173",
      process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3010",
    ],
    secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: outboxDir,
    productMediaDir,
  };

  built = await buildApp(config);

  const ownerLogin = process.env.BRAVOS_SETUP_OWNER_LOGIN ?? "owner";
  const ownerDisplayName = process.env.BRAVOS_SETUP_OWNER_DISPLAY_NAME ?? "مالك برافوس";
  const cashierLogin = process.env.BRAVOS_SETUP_DEMO_CASHIER_LOGIN ?? "cashier";
  const previous = await readPreviousCredentials(credentialsPath);

  const existingOwner = await built.pool.query<{ username: string }>(
    `SELECT u.username
     FROM staff_profile p
     JOIN "user" u ON u.id = p.staff_id
     WHERE p.is_owner`,
  );
  const existingOwnerLogin = existingOwner.rows[0]?.username;
  if (existingOwnerLogin && existingOwnerLogin !== ownerLogin.toLowerCase()) {
    throw new Error(
      `An owner already exists as "${existingOwnerLogin}". Refusing to create another owner for "${ownerLogin}".`,
    );
  }

  const suppliedOwnerPassword = process.env.BRAVOS_SETUP_OWNER_PASSWORD;
  const suppliedCashierPassword = process.env.BRAVOS_SETUP_DEMO_CASHIER_PASSWORD;
  let ownerPassword = suppliedOwnerPassword;
  let cashierPassword = suppliedCashierPassword;
  let ownerCreated = false;
  let cashierCreated = false;

  if (!ownerPassword) {
    if (previous.ownerLogin === ownerLogin && previous.ownerPassword) {
      ownerPassword = previous.ownerPassword;
    } else {
      ownerPassword = randomPassword();
    }
  }

  try {
    await ensureOwner(built.services, {
      loginName: ownerLogin,
      displayName: ownerDisplayName,
      password: ownerPassword,
    });
    ownerCreated = true;
  } catch (error) {
    if (!(error instanceof DuplicateLoginNameError)) {
      throw error;
    }
  }

  const owner = await built.pool.query<{ id: string }>(
    `SELECT id FROM "user" WHERE username = $1`,
    [ownerLogin.toLowerCase()],
  );
  const ownerId = owner.rows[0]?.id ?? null;

  const branches = await built.pool.query<{ id: string; code: string }>("SELECT id, code FROM branch");
  const abshwayId = branches.rows.find((row) => row.code === "abshway")?.id;
  const fayoumId = branches.rows.find((row) => row.code === "fayoum")?.id;
  if (!abshwayId || !fayoumId) {
    throw new Error("Required branches are missing.");
  }

  if (!cashierPassword) {
    if (previous.cashierLogin === cashierLogin && previous.cashierPassword) {
      cashierPassword = previous.cashierPassword;
    } else {
      cashierPassword = randomPassword();
    }
  }

  try {
    await built.services.createStaffRecord(
      {
        loginName: cashierLogin,
        displayName: "كاشير تجريبي",
        password: cashierPassword,
        role: "employee",
        grants: [
          { branchId: abshwayId, cashier: true, orderRepresentative: false },
          { branchId: fayoumId, cashier: true, orderRepresentative: false },
        ],
      },
      { isOwner: false, role: "employee", actorStaffId: ownerId },
    );
    cashierCreated = true;
  } catch (error) {
    if (!(error instanceof DuplicateLoginNameError)) {
      throw error;
    }
  }

  await mkdir(setupRoot, { recursive: true });
  const envFile = [
    "NODE_ENV=development",
    `DATABASE_URL=${databaseUrl}`,
    `BETTER_AUTH_SECRET=${config.authSecret}`,
    `BETTER_AUTH_URL=${config.authBaseUrl}`,
    `BRAVOS_INTERNAL_ORIGIN=${config.internalOrigin}`,
    `BRAVOS_PUBLIC_ORIGIN=${config.publicOrigin}`,
    "BRAVOS_OWNER_RECOVERY_ADAPTER=local-outbox",
    `BRAVOS_OWNER_RECOVERY_OUTBOX_DIR=${outboxDir.replaceAll("\\", "/")}`,
    `BRAVOS_PRODUCT_MEDIA_DIR=${productMediaDir.replaceAll("\\", "/")}`,
    "BRAVOS_SECURE_COOKIES=false",
    "",
  ].join("\n");
  await writeFile(envPath, envFile, "utf8");

  const recorded = await recordVerifiedSetupCredentials({
    app: built.app,
    origin: config.internalOrigin,
    credentialsPath,
    ownerLogin,
    cashierLogin,
    ownerCreated,
    cashierCreated,
    createdOwnerPassword: ownerCreated ? ownerPassword : undefined,
    createdCashierPassword: cashierCreated ? cashierPassword : undefined,
    suppliedOwnerPassword,
    suppliedCashierPassword,
    previous,
  });

  console.log(`Local labeled setup wrote ${path.relative(process.cwd(), envPath)} and ${path.relative(process.cwd(), credentialsPath)}`);
  if (!ownerCreated || !cashierCreated) {
    console.log("Repeated setup preserved existing accounts; passwords were not rotated.");
  }
  if (recorded.ownerPasswordState === "unknown" || recorded.cashierPasswordState === "unknown") {
    console.log("Some demo passwords could not be verified and were recorded as unknown.");
  }
} finally {
  try {
    if (built) {
      await built.close();
    }
  } finally {
    if (cluster) {
      await cluster.stop();
    }
  }
}

function randomPassword(): string {
  return `dev-${crypto.randomUUID().slice(0, 12)}`;
}

async function readPreviousCredentials(file: string) {
  try {
    const text = await readFile(file, "utf8");
    return {
      ownerLogin: capture(text, /owner login: (\S+)/),
      ownerPassword: capture(text, /owner password: (\S+)/),
      cashierLogin: capture(text, /demo cashier login: (\S+)/),
      cashierPassword: capture(text, /demo cashier password: (\S+)/),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ownerLogin: undefined,
        ownerPassword: undefined,
        cashierLogin: undefined,
        cashierPassword: undefined,
      };
    }
    throw error;
  }
}

function capture(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  const value = match?.[1];
  if (!value || value === "unchanged" || value === "unknown") {
    return undefined;
  }
  return value;
}

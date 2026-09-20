import { inspectMigrations, applyMigrations, type MigrationStatus } from "@bravos/persistence";
import { Pool } from "pg";

const command = process.argv[2];
if (command !== "status" && command !== "apply") {
  throw new Error("Usage: pnpm release:migrate <status|apply>");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  const before = await inspectMigrations(pool);
  printStatus("before", before);
  assertNoDrift(before);
  if (command === "apply") {
    const applied = await applyMigrations(pool);
    console.log(applied.length === 0
      ? "No migrations were pending."
      : `Applied migrations: ${applied.join(", ")}`);
    const after = await inspectMigrations(pool);
    printStatus("after", after);
    assertNoDrift(after);
    if (after.pending.length > 0) throw new Error("Migrations remain pending after apply.");
  }
} finally {
  await pool.end();
}

function printStatus(stage: string, status: MigrationStatus): void {
  console.log(JSON.stringify({
    stage,
    applied: status.applied,
    pending: status.pending,
    unexpected: status.unexpected,
    outOfOrder: status.outOfOrder,
  }, null, 2));
}

function assertNoDrift(status: MigrationStatus): void {
  if (status.unexpected.length === 0 && !status.outOfOrder) return;
  throw new Error("Migration history differs from this release. Refusing to continue.");
}

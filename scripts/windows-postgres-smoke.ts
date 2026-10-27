import { Pool } from "pg";
import { startPostgresCluster } from "@bravos/testkit";

if (process.platform !== "win32") {
  throw new Error("windows-postgres-smoke runs only on Windows.");
}

const cluster = await startPostgresCluster({ port: 55439 });
const pool = new Pool({ connectionString: cluster.connectionString("postgres") });
try {
  const result = await pool.query("SELECT 1 AS ok");
  const value = result.rows[0]?.ok;
  if (Number(value) !== 1) {
    throw new Error(`SELECT 1 returned ${String(value)}`);
  }
  console.log("windows-postgres-smoke: SELECT 1 succeeded");
} finally {
  try {
    await pool.end();
  } finally {
    await cluster.stop();
  }
}
console.log("windows-postgres-smoke: shutdown complete; listener closed");

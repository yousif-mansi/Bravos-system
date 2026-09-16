import type { Pool, PoolClient } from "pg";
import type { ReportingReadContext, ReportingReadUnitOfWork } from "../application/ports.ts";

export function createPostgresReportingReadUnitOfWork(
  pool: Pool,
  readers: (client: PoolClient) => ReportingReadContext,
): ReportingReadUnitOfWork {
  return {
    async run(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const result = await work(readers(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

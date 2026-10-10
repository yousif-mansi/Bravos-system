import type { Pool, PoolClient } from "pg";
import type { OpeningImportReportingReader } from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;

const OPERATION_PAGE_LIMIT = 500;

export function createPostgresOpeningImportReportingReader(queryable: Queryable): OpeningImportReportingReader {
  return {
    async acceptedStockOperationIds(operationIds) {
      if (operationIds.length === 0) return new Set();
      if (operationIds.length > OPERATION_PAGE_LIMIT) {
        throw new Error("Opening import reporting lookup exceeds the bounded page.");
      }
      // Only an accepted preview with a real batch list is opening stock.
      // Configuration-only acceptance must leave a later receipt in purchases.
      const result = await queryable.query<{ operation_id: string }>(
        `SELECT operation_id
         FROM opening_import_preview
         WHERE status = 'accepted'
           AND operation_id = ANY($1::uuid[])
           AND CASE
             WHEN jsonb_typeof(plan_json -> 'batches') = 'array'
               THEN jsonb_array_length(plan_json -> 'batches') > 0
             ELSE FALSE
           END`,
        [operationIds],
      );
      return new Set(result.rows.map((row) => row.operation_id));
    },
  };
}

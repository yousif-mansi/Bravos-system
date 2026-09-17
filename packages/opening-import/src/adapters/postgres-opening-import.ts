import type { OpeningImportPreviewDto } from "@bravos/contracts";
import type { Pool, PoolClient } from "pg";
import { OpeningImportStaleError } from "../domain/errors.ts";
import type { OpeningImportPlan } from "../domain/model.ts";
import type { OpeningImportPreviewRecord, OpeningImportStore, OpeningImportTransaction } from "../application/ports.ts";

type OpeningImportFeatures = Pick<OpeningImportTransaction,
  "catalog" | "inventory" | "receiving" | "expenses" | "pricing" | "storefront" | "orders">;

type PreviewRow = {
  id: string;
  operation_id: string;
  input_fingerprint: string;
  preview_fingerprint: string;
  status: "invalid" | "ready" | "accepted";
  plan_json: OpeningImportPlan;
  state_json: unknown;
  response_json: OpeningImportPreviewDto;
};

export function createPostgresOpeningImportStore(
  pool: Pool,
  features: (client: PoolClient) => OpeningImportFeatures,
): OpeningImportStore {
  return {
    async getPreview(id) {
      const result = await pool.query<PreviewRow>(
        `SELECT id,operation_id,input_fingerprint,preview_fingerprint,status,plan_json,state_json,response_json
         FROM opening_import_preview WHERE id=$1`,
        [id],
      );
      return result.rows[0]?.response_json ?? null;
    },
    run(work) {
      return transaction(pool, async (client) => {
        const bound = features(client);
        return work({
          ...bound,
          async findByOperation(operationId) { return toRecord(await byOperation(client, operationId)); },
          async findById(previewId) { return toRecord(await byId(client, previewId)); },
          async insertPreview(input) {
            await client.query(
              `INSERT INTO opening_import_preview (
                 id,operation_id,input_fingerprint,preview_fingerprint,status,
                 plan_json,state_json,response_json,created_by_staff_id,created_at
               ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)`,
              [input.id,input.operationId,input.inputFingerprint,input.previewFingerprint,input.status,
                JSON.stringify(input.plan),JSON.stringify(input.state),JSON.stringify(input.response),
                input.actorStaffId,input.createdAt],
            );
          },
          async markAccepted(input) {
            await client.query(
              `UPDATE opening_import_preview
               SET status='accepted',response_json=$2::jsonb,accepted_by_staff_id=$3,accepted_at=$4
               WHERE id=$1`,
              [input.previewId,JSON.stringify(input.response),input.actorStaffId,input.acceptedAt],
            );
          },
        });
      });
    },
  };
}

async function byOperation(client: PoolClient, operationId: string) {
  const result = await client.query<PreviewRow>(
    `SELECT id,operation_id,input_fingerprint,preview_fingerprint,status,plan_json,state_json,response_json
     FROM opening_import_preview WHERE operation_id=$1 FOR UPDATE`,
    [operationId],
  );
  return result.rows[0] ?? null;
}

async function byId(client: PoolClient, previewId: string) {
  const result = await client.query<PreviewRow>(
    `SELECT id,operation_id,input_fingerprint,preview_fingerprint,status,plan_json,state_json,response_json
     FROM opening_import_preview WHERE id=$1 FOR UPDATE`,
    [previewId],
  );
  return result.rows[0] ?? null;
}

function toRecord(row: PreviewRow | null): OpeningImportPreviewRecord | null {
  return row ? {
    id: row.id,
    operationId: row.operation_id,
    inputFingerprint: row.input_fingerprint,
    previewFingerprint: row.preview_fingerprint,
    status: row.status,
    plan: row.plan_json,
    state: row.state_json,
    response: row.response_json,
  } : null;
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT restore_enter_business_write()");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    if (isSerialization(error)) throw new OpeningImportStaleError("تغيرت البيانات أثناء الاستيراد. أنشئ معاينة جديدة.");
    throw error;
  } finally {
    client.release();
  }
}

function isSerialization(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: string }).code === "40001";
}

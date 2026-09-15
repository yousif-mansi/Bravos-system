import type { PoolClient } from "pg";
import type { OpeningReceivingTransaction } from "../application/ports.ts";

export function createPostgresOpeningReceivingTransaction(client: PoolClient): OpeningReceivingTransaction {
  return {
    async insertOpeningReceipt(input) {
      await client.query(
        `INSERT INTO receiving_receipt (id,operation_id,receipt_date,received_by_staff_id,recorded_at)
         VALUES ($1,$2,$3::date,$4,$5)`,
        [input.receiptId,input.operationId,input.receiptDate,input.actorStaffId,input.recordedAt],
      );
      for (const line of input.lines) {
        await client.query(
          `INSERT INTO receiving_receipt_line (id,receipt_id,variant_id,quantity,unit_cost_piasters,batch_id,line_index)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [line.id,input.receiptId,line.variantId,line.quantity,line.unitCostPiasters,line.batchId,line.lineIndex],
        );
      }
    },
  };
}

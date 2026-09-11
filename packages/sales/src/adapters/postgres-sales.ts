import type { Pool, PoolClient } from "pg";
import { OperationConflictError, type InventoryTransaction } from "@bravos/inventory";
import type {
  SaleInsert,
  SaleLineWrite,
  SaleRecord,
  SaleStore,
  SaleUnitWrite,
  SalesUnitOfWork,
} from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;

type SaleRow = {
  id: string;
  operation_id: string;
  branch_id: string;
  sold_by_staff_id: string;
  sold_by_display_name: string;
  discounted_by_staff_id: string | null;
  occurred_at: Date;
  recorded_at: Date | null;
  customer_name: string | null;
  customer_phone: string | null;
  original_total_piasters: number;
  employee_discount_piasters: number;
  discount_reason: string | null;
  final_total_piasters: number;
  payload_fingerprint: string;
  physically_completed: boolean;
  costs_incomplete: boolean;
};

type LineRow = {
  id: string;
  sale_id: string;
  variant_id: string;
  quantity: number;
  listed_unit_price_piasters: number;
  original_piasters: number;
  discount_piasters: number;
  paid_piasters: number;
  allocated_quantity: number;
  unallocated_quantity: number;
  line_index: number;
};

type UnitRow = {
  id: string;
  sale_id: string;
  line_id: string;
  unit_index: number;
  listed_piasters: number;
  discount_piasters: number;
  paid_piasters: number;
};

export function createPostgresSaleStore(queryable: Queryable): SaleStore {
  return {
    async lockIdentities(saleId, operationId) {
      const keys = saleId === operationId ? [saleId] : [saleId, operationId].sort();
      for (const key of keys) {
        await queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
      }
    },

    async insert(input) {
      await queryable.query("SAVEPOINT sale_insert");
      try {
        const inserted = await queryable.query<{ id: string }>(
          `INSERT INTO sales_sale (
             id, operation_id, branch_id, sold_by_staff_id, sold_by_display_name, discounted_by_staff_id,
             occurred_at, recorded_at, customer_name, customer_phone, original_total_piasters,
             employee_discount_piasters, discount_reason, final_total_piasters, payload_fingerprint,
             physically_completed, costs_incomplete
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
           ) ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [
            input.id,
            input.operationId,
            input.branchId,
            input.soldByStaffId,
            input.soldByDisplayName,
            input.discountedByStaffId,
            input.occurredAt,
            input.recordedAt,
            input.customerName,
            input.customerPhone,
            input.originalTotalPiasters,
            input.employeeDiscountPiasters,
            input.discountReason,
            input.finalTotalPiasters,
            input.payloadFingerprint,
            input.physicallyCompleted,
            input.costsIncomplete,
          ],
        );
        if (!inserted.rows[0]) {
          await queryable.query("RELEASE SAVEPOINT sale_insert");
          const existing = await loadById(queryable, input.id);
          if (!existing) {
            throw new OperationConflictError();
          }
          return { kind: "existing", record: existing };
        }
        await insertLines(queryable, input.id, input.lines);
        await queryable.query("RELEASE SAVEPOINT sale_insert");
        const loaded = await loadById(queryable, input.id);
        if (!loaded) {
          throw new Error("Created sale could not be loaded.");
        }
        return { kind: "created", record: loaded };
      } catch (error) {
        await queryable.query("ROLLBACK TO SAVEPOINT sale_insert").catch(() => undefined);
        if (isUniqueViolation(error) || error instanceof OperationConflictError) {
          throw new OperationConflictError();
        }
        throw error;
      }
    },

    async updateCompletion(input) {
      await queryable.query(
        `UPDATE sales_sale
         SET occurred_at = $2, recorded_at = $3, physically_completed = true, costs_incomplete = $4
         WHERE id = $1`,
        [input.id, input.occurredAt, input.recordedAt, input.costsIncomplete],
      );
      for (const line of input.lines) {
        await queryable.query(
          `UPDATE sales_sale_line
           SET allocated_quantity = $2, unallocated_quantity = $3
           WHERE id = $1`,
          [line.id, line.allocatedQuantity, line.unallocatedQuantity],
        );
      }
      const loaded = await loadById(queryable, input.id);
      if (!loaded) {
        throw new Error("Updated sale could not be loaded.");
      }
      return loaded;
    },

    getById: (id) => loadById(queryable, id),
    getByOperationId: (operationId) => loadByOperationId(queryable, operationId),
    async listCompleted() {
      return loadMany(
        queryable,
        `SELECT * FROM sales_sale WHERE physically_completed = true ORDER BY recorded_at DESC, id DESC`,
        [],
      );
    },
    async listCompletedForStaff(staffId, branchIds) {
      if (branchIds.length === 0) {
        return [];
      }
      return loadMany(
        queryable,
        `SELECT * FROM sales_sale
         WHERE physically_completed = true AND sold_by_staff_id = $1 AND branch_id = ANY($2::uuid[])
         ORDER BY recorded_at DESC, id DESC`,
        [staffId, branchIds],
      );
    },
    async referencedVariantIds(variantIds) {
      if (variantIds.length === 0) {
        return [];
      }
      const result = await queryable.query<{ variant_id: string }>(
        `SELECT DISTINCT variant_id FROM sales_sale_line WHERE variant_id = ANY($1::uuid[])`,
        [variantIds],
      );
      return result.rows.map((row) => row.variant_id);
    },
  };
}

export function createPostgresSalesUnitOfWork(
  pool: Pool,
  inventoryFor: (client: PoolClient) => InventoryTransaction,
): SalesUnitOfWork {
  return {
    async run(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work({
          sales: createPostgresSaleStore(client),
          inventory: inventoryFor(client),
        });
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

async function insertLines(queryable: Queryable, saleId: string, lines: SaleLineWrite[]) {
  for (const line of lines) {
    await queryable.query(
      `INSERT INTO sales_sale_line (
         id, sale_id, variant_id, quantity, listed_unit_price_piasters, original_piasters,
         discount_piasters, paid_piasters, allocated_quantity, unallocated_quantity, line_index
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        line.id,
        saleId,
        line.variantId,
        line.quantity,
        line.listedUnitPricePiasters,
        line.originalPiasters,
        line.discountPiasters,
        line.paidPiasters,
        line.allocatedQuantity,
        line.unallocatedQuantity,
        line.lineIndex,
      ],
    );
    for (const unit of line.units) {
      await insertUnit(queryable, saleId, line.id, unit);
    }
  }
}

async function insertUnit(queryable: Queryable, saleId: string, lineId: string, unit: SaleUnitWrite) {
  await queryable.query(
    `INSERT INTO sales_sale_unit (
       id, sale_id, line_id, unit_index, listed_piasters, discount_piasters, paid_piasters
     ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
    [saleId, lineId, unit.unitIndex, unit.listedPiasters, unit.discountPiasters, unit.paidPiasters],
  );
}

async function loadById(queryable: Queryable, id: string): Promise<SaleRecord | null> {
  const result = await queryable.query<SaleRow>(`SELECT * FROM sales_sale WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return toSale(row, await loadLines(queryable, row.id));
}

async function loadByOperationId(queryable: Queryable, operationId: string): Promise<SaleRecord | null> {
  const result = await queryable.query<SaleRow>(`SELECT * FROM sales_sale WHERE operation_id = $1`, [operationId]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return toSale(row, await loadLines(queryable, row.id));
}

async function loadMany(queryable: Queryable, sql: string, params: unknown[]): Promise<SaleRecord[]> {
  const result = await queryable.query<SaleRow>(sql, params);
  const ids = result.rows.map((row) => row.id);
  const lines = await loadLinesForSales(queryable, ids);
  return result.rows.map((row) => toSale(row, lines.get(row.id) ?? []));
}

async function loadLines(queryable: Queryable, saleId: string): Promise<SaleLineWrite[]> {
  const grouped = await loadLinesForSales(queryable, [saleId]);
  return grouped.get(saleId) ?? [];
}

async function loadLinesForSales(queryable: Queryable, saleIds: string[]): Promise<Map<string, SaleLineWrite[]>> {
  const grouped = new Map<string, SaleLineWrite[]>();
  if (saleIds.length === 0) {
    return grouped;
  }
  const lines = await queryable.query<LineRow>(
    `SELECT * FROM sales_sale_line WHERE sale_id = ANY($1::uuid[]) ORDER BY sale_id, line_index`,
    [saleIds],
  );
  const units = await queryable.query<UnitRow>(
    `SELECT * FROM sales_sale_unit WHERE sale_id = ANY($1::uuid[]) ORDER BY line_id, unit_index`,
    [saleIds],
  );
  const unitsByLine = new Map<string, SaleUnitWrite[]>();
  for (const row of units.rows) {
    const list = unitsByLine.get(row.line_id) ?? [];
    list.push({
      unitIndex: row.unit_index,
      listedPiasters: row.listed_piasters,
      discountPiasters: row.discount_piasters,
      paidPiasters: row.paid_piasters,
    });
    unitsByLine.set(row.line_id, list);
  }
  for (const row of lines.rows) {
    const list = grouped.get(row.sale_id) ?? [];
    list.push({
      id: row.id,
      variantId: row.variant_id,
      quantity: row.quantity,
      listedUnitPricePiasters: row.listed_unit_price_piasters,
      originalPiasters: row.original_piasters,
      discountPiasters: row.discount_piasters,
      paidPiasters: row.paid_piasters,
      allocatedQuantity: row.allocated_quantity,
      unallocatedQuantity: row.unallocated_quantity,
      lineIndex: row.line_index,
      units: unitsByLine.get(row.id) ?? [],
    });
    grouped.set(row.sale_id, list);
  }
  return grouped;
}

function toSale(row: SaleRow, lines: SaleLineWrite[]): SaleRecord {
  return {
    id: row.id,
    operationId: row.operation_id,
    branchId: row.branch_id,
    soldByStaffId: row.sold_by_staff_id,
    soldByDisplayName: row.sold_by_display_name,
    discountedByStaffId: row.discounted_by_staff_id,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    originalTotalPiasters: row.original_total_piasters,
    employeeDiscountPiasters: row.employee_discount_piasters,
    discountReason: row.discount_reason,
    finalTotalPiasters: row.final_total_piasters,
    payloadFingerprint: row.payload_fingerprint,
    physicallyCompleted: row.physically_completed,
    costsIncomplete: row.costs_incomplete,
    lines,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505");
}

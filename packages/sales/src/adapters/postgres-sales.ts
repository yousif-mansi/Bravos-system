import type { CompletedOperationProofDto } from "@bravos/contracts";
import type { Pool, PoolClient } from "pg";
import type { CouponUsageTransaction } from "@bravos/pricing";
import { OperationConflictError, type InventoryTransaction } from "@bravos/inventory";
import type {
  AutomaticPricingPort,
  ListedPriceReader,
  PricingQuoteReader,
  PriceSnapshotRecord,
  PriceSnapshotStore,
  SaleInsert,
  SaleLineWrite,
  SaleRecord,
  SaleStore,
  SaleUnitWrite,
  SalesUnitOfWork,
} from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  original_total_piasters: number | string;
  automatic_offer_discount_piasters: number | string;
  applied_automatic_offer_id: string | null;
  applied_automatic_offer_name_ar: string | null;
  applied_automatic_offer_type: "percentage" | "fixed" | "fixed_bundle" | "buy_x_get_y" | null;
  applied_automatic_offer_percentage_basis_points: number | null;
  applied_automatic_offer_fixed_discount_piasters: number | string | null;
  applied_automatic_offer_allow_coupon: boolean | null;
  applied_automatic_offer_details: unknown;
  coupon_discount_piasters: number | string;
  applied_coupon_id: string | null;
  applied_coupon_code: string | null;
  applied_coupon_type: "percentage" | "fixed" | null;
  applied_coupon_percentage_basis_points: number | null;
  applied_coupon_fixed_discount_piasters: number | string | null;
  applied_coupon_allow_automatic_offer: boolean | null;
  coupon_usage_discrepancy_detected_at: Date | null;
  coupon_usage_limit: number | null;
  coupon_usage_count_before: number | null;
  coupon_usage_actual_count: number | null;
  employee_discount_piasters: number | string;
  discount_reason: string | null;
  final_total_piasters: number | string;
  exchange_credit_applied_piasters: number | string;
  cash_received_piasters: number | string;
  payload_fingerprint: string;
  physically_completed: boolean;
  costs_incomplete: boolean;
  recovered_by_staff_id: string | null;
  recovered_at: Date | null;
};

type LineRow = {
  id: string;
  sale_id: string;
  variant_id: string;
  quantity: number;
  listed_unit_price_piasters: number;
  original_piasters: number | string;
  discount_piasters: number | string;
  paid_piasters: number | string;
  automatic_offer_discount_piasters: number | string;
  coupon_discount_piasters: number | string;
  employee_discount_piasters: number | string;
  allocated_quantity: number;
  unallocated_quantity: number;
  line_index: number;
};

type UnitRow = {
  id: string;
  sale_id: string;
  line_id: string;
  unit_index: number;
  quantity: number | string;
  listed_piasters: number | string;
  discount_piasters: number | string;
  paid_piasters: number | string;
  automatic_offer_discount_piasters: number | string;
  coupon_discount_piasters: number | string;
  employee_discount_piasters: number | string;
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
             automatic_offer_discount_piasters, applied_automatic_offer_id, applied_automatic_offer_name_ar,
             applied_automatic_offer_type, applied_automatic_offer_percentage_basis_points,
             applied_automatic_offer_fixed_discount_piasters, applied_automatic_offer_allow_coupon,
             applied_automatic_offer_details,
             coupon_discount_piasters, applied_coupon_id, applied_coupon_code, applied_coupon_type,
             applied_coupon_percentage_basis_points, applied_coupon_fixed_discount_piasters,
             applied_coupon_allow_automatic_offer, employee_discount_piasters, discount_reason, final_total_piasters, payload_fingerprint,
             physically_completed, costs_incomplete, recovered_by_staff_id, recovered_at,
             exchange_credit_applied_piasters, cash_received_piasters,
             coupon_usage_discrepancy_detected_at, coupon_usage_limit, coupon_usage_count_before,
             coupon_usage_actual_count
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
             $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34,
             $35, $36, $37, $38, $39, $40
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
            input.automaticOfferDiscountPiasters,
            input.appliedAutomaticOffer?.id ?? null,
            input.appliedAutomaticOffer?.nameAr ?? null,
            input.appliedAutomaticOffer?.discountType ?? null,
            input.appliedAutomaticOffer?.percentageBasisPoints ?? null,
            input.appliedAutomaticOffer?.fixedDiscountPiasters ?? null,
            input.appliedAutomaticOffer?.allowCoupon ?? null,
            appliedOfferDetails(input.appliedAutomaticOffer),
            input.couponDiscountPiasters,
            input.appliedCoupon?.id ?? null,
            input.appliedCoupon?.code ?? null,
            input.appliedCoupon?.discountType ?? null,
            input.appliedCoupon?.percentageBasisPoints ?? null,
            input.appliedCoupon?.fixedDiscountPiasters ?? null,
            input.appliedCoupon?.allowAutomaticOffer ?? null,
            input.employeeDiscountPiasters,
            input.discountReason,
            input.finalTotalPiasters,
            input.payloadFingerprint,
            input.physicallyCompleted,
            input.costsIncomplete,
            input.recoveredByStaffId ?? null,
            input.recoveredAt ?? null,
            input.exchangeCreditAppliedPiasters ?? 0,
            input.cashReceivedPiasters ?? input.finalTotalPiasters,
            input.couponUsageDiscrepancy?.detectedAt ?? null,
            input.couponUsageDiscrepancy?.usageLimit ?? null,
            input.couponUsageDiscrepancy?.countBefore ?? null,
            input.couponUsageDiscrepancy?.actualCount ?? null,
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
         SET occurred_at = $2, recorded_at = $3, physically_completed = true, costs_incomplete = $4,
             recovered_by_staff_id = COALESCE($5, recovered_by_staff_id),
             recovered_at = COALESCE($6, recovered_at),
             coupon_usage_discrepancy_detected_at = COALESCE($7, coupon_usage_discrepancy_detected_at),
             coupon_usage_limit = COALESCE($8, coupon_usage_limit),
             coupon_usage_count_before = COALESCE($9, coupon_usage_count_before),
             coupon_usage_actual_count = COALESCE($10, coupon_usage_actual_count)
         WHERE id = $1`,
        [
          input.id,
          input.occurredAt,
          input.recordedAt,
          input.costsIncomplete,
          input.recoveredByStaffId ?? null,
          input.recoveredAt ?? null,
          input.couponUsageDiscrepancy?.detectedAt ?? null,
          input.couponUsageDiscrepancy?.usageLimit ?? null,
          input.couponUsageDiscrepancy?.countBefore ?? null,
          input.couponUsageDiscrepancy?.actualCount ?? null,
        ],
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
    async listCompletedOperationProofs(operationIds) {
      return loadCompletedProofs(queryable, operationIds);
    },
    async listCompletedOperationIds(operationIds) {
      const proofs = await loadCompletedProofs(queryable, operationIds);
      return proofs.map((proof) => proof.operationId);
    },
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
  couponUsageFor: (client: PoolClient) => CouponUsageTransaction,
): SalesUnitOfWork {
  return {
    async run(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work({
          sales: createPostgresSaleStore(client),
          inventory: inventoryFor(client),
          snapshots: createPostgresPriceSnapshotStore(client),
          couponUsage: couponUsageFor(client),
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

export function createPostgresPricingQuoteReader(
  pool: Pool,
  pricingFor: (client: PoolClient) => {
    prices: ListedPriceReader;
    automaticPricing: AutomaticPricingPort;
  },
): PricingQuoteReader {
  return {
    async run(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const result = await work(pricingFor(client));
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
         discount_piasters, paid_piasters, automatic_offer_discount_piasters,
         coupon_discount_piasters, employee_discount_piasters, allocated_quantity, unallocated_quantity, line_index
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        line.id,
        saleId,
        line.variantId,
        line.quantity,
        line.listedUnitPricePiasters,
        line.originalPiasters,
        line.discountPiasters,
        line.paidPiasters,
        line.automaticOfferDiscountPiasters,
        line.couponDiscountPiasters,
        line.employeeDiscountPiasters,
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
       id, sale_id, line_id, unit_index, quantity, listed_piasters, discount_piasters, paid_piasters,
       automatic_offer_discount_piasters, employee_discount_piasters
       , coupon_discount_piasters
     ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      saleId,
      lineId,
      unit.unitIndex,
      unit.quantity,
      unit.listedPiasters,
      unit.discountPiasters,
      unit.paidPiasters,
      unit.automaticOfferDiscountPiasters,
      unit.employeeDiscountPiasters,
      unit.couponDiscountPiasters,
    ],
  );
}

async function loadCompletedProofs(queryable: Queryable, operationIds: string[]): Promise<CompletedOperationProofDto[]> {
  const unique = [...new Set(operationIds.filter((id) => UUID_PATTERN.test(id)))];
  if (unique.length === 0) {
    return [];
  }
  const result = await queryable.query<{
    id: string;
    operation_id: string;
    payload_fingerprint: string;
  }>(
    `SELECT id, operation_id, payload_fingerprint
     FROM sales_sale
     WHERE physically_completed = true AND operation_id = ANY($1::uuid[])`,
    [unique],
  );
  return result.rows
    .filter((row) => typeof row.payload_fingerprint === "string" && /^[0-9a-f]{64}$/i.test(row.payload_fingerprint))
    .map((row) => ({
      operationId: row.operation_id,
      saleId: row.id,
      contentDigest: row.payload_fingerprint,
    }));
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
      quantity: asSafeInteger(row.quantity),
      listedPiasters: asSafeInteger(row.listed_piasters),
      discountPiasters: asSafeInteger(row.discount_piasters),
      paidPiasters: asSafeInteger(row.paid_piasters),
      automaticOfferDiscountPiasters: asSafeInteger(row.automatic_offer_discount_piasters),
      couponDiscountPiasters: asSafeInteger(row.coupon_discount_piasters),
      employeeDiscountPiasters: asSafeInteger(row.employee_discount_piasters),
    });
    unitsByLine.set(row.line_id, list);
  }
  for (const row of lines.rows) {
    const list = grouped.get(row.sale_id) ?? [];
    list.push({
      id: row.id,
      variantId: row.variant_id,
      quantity: asSafeInteger(row.quantity),
      listedUnitPricePiasters: asSafeInteger(row.listed_unit_price_piasters),
      originalPiasters: asSafeInteger(row.original_piasters),
      discountPiasters: asSafeInteger(row.discount_piasters),
      paidPiasters: asSafeInteger(row.paid_piasters),
      automaticOfferDiscountPiasters: asSafeInteger(row.automatic_offer_discount_piasters),
      couponDiscountPiasters: asSafeInteger(row.coupon_discount_piasters),
      employeeDiscountPiasters: asSafeInteger(row.employee_discount_piasters),
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
    originalTotalPiasters: asSafeInteger(row.original_total_piasters),
    automaticOfferDiscountPiasters: asSafeInteger(row.automatic_offer_discount_piasters),
    appliedAutomaticOffer: toAppliedOffer(row),
    couponDiscountPiasters: asSafeInteger(row.coupon_discount_piasters),
    appliedCoupon: row.applied_coupon_id && row.applied_coupon_code && row.applied_coupon_type
      ? {
          id: row.applied_coupon_id,
          code: row.applied_coupon_code,
          discountType: row.applied_coupon_type,
          percentageBasisPoints: row.applied_coupon_percentage_basis_points,
          fixedDiscountPiasters: row.applied_coupon_fixed_discount_piasters === null
            ? null : asSafeInteger(row.applied_coupon_fixed_discount_piasters),
          allowAutomaticOffer: row.applied_coupon_allow_automatic_offer ?? true,
          discountPiasters: asSafeInteger(row.coupon_discount_piasters),
        }
      : null,
    couponUsageDiscrepancy:
      row.coupon_usage_discrepancy_detected_at !== null
      && row.coupon_usage_limit !== null
      && row.coupon_usage_count_before !== null
      && row.coupon_usage_actual_count !== null
        ? {
            detectedAt: row.coupon_usage_discrepancy_detected_at,
            usageLimit: row.coupon_usage_limit,
            countBefore: row.coupon_usage_count_before,
            actualCount: row.coupon_usage_actual_count,
          }
        : null,
    employeeDiscountPiasters: asSafeInteger(row.employee_discount_piasters),
    discountReason: row.discount_reason,
    finalTotalPiasters: asSafeInteger(row.final_total_piasters),
    exchangeCreditAppliedPiasters: asSafeInteger(row.exchange_credit_applied_piasters),
    cashReceivedPiasters: asSafeInteger(row.cash_received_piasters),
    payloadFingerprint: row.payload_fingerprint,
    physicallyCompleted: row.physically_completed,
    costsIncomplete: row.costs_incomplete,
    recoveredByStaffId: row.recovered_by_staff_id,
    recoveredAt: row.recovered_at,
    lines,
  };
}

function appliedOfferDetails(offer: SaleRecord["appliedAutomaticOffer"]): string | null {
  if (!offer || offer.discountType === "percentage" || offer.discountType === "fixed") return null;
  return JSON.stringify({
    bundlePricePiasters: offer.bundlePricePiasters,
    bundleItems: offer.bundleItems,
    buyQuantity: offer.buyQuantity,
    rewardQuantity: offer.rewardQuantity,
    rewardPercentageBasisPoints: offer.rewardPercentageBasisPoints,
  });
}

function toAppliedOffer(row: SaleRow): SaleRecord["appliedAutomaticOffer"] {
  if (!row.applied_automatic_offer_id || !row.applied_automatic_offer_name_ar || !row.applied_automatic_offer_type) {
    return null;
  }
  const details = offerDetails(row.applied_automatic_offer_details);
  return {
    id: row.applied_automatic_offer_id,
    nameAr: row.applied_automatic_offer_name_ar,
    discountType: row.applied_automatic_offer_type,
    percentageBasisPoints: row.applied_automatic_offer_percentage_basis_points,
    fixedDiscountPiasters: row.applied_automatic_offer_fixed_discount_piasters === null
      ? null
      : asSafeInteger(row.applied_automatic_offer_fixed_discount_piasters),
    bundlePricePiasters: details.bundlePricePiasters,
    bundleItems: details.bundleItems,
    buyQuantity: details.buyQuantity,
    rewardQuantity: details.rewardQuantity,
    rewardPercentageBasisPoints: details.rewardPercentageBasisPoints,
    allowCoupon: row.applied_automatic_offer_allow_coupon ?? true,
    discountPiasters: asSafeInteger(row.automatic_offer_discount_piasters),
  };
}

function offerDetails(value: unknown): {
  bundlePricePiasters: number | null;
  bundleItems: Array<{ variantId: string; requiredQuantity: number }>;
  buyQuantity: number | null;
  rewardQuantity: number | null;
  rewardPercentageBasisPoints: number | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { bundlePricePiasters: null, bundleItems: [], buyQuantity: null, rewardQuantity: null, rewardPercentageBasisPoints: null };
  }
  const details = value as Record<string, unknown>;
  return {
    bundlePricePiasters: nullableSafeInteger(details.bundlePricePiasters),
    bundleItems: Array.isArray(details.bundleItems) ? details.bundleItems.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid retained bundle item.");
      const row = item as Record<string, unknown>;
      if (typeof row.variantId !== "string") throw new Error("Invalid retained bundle item.");
      return { variantId: row.variantId, requiredQuantity: nullableSafeInteger(row.requiredQuantity) ?? 0 };
    }) : [],
    buyQuantity: nullableSafeInteger(details.buyQuantity),
    rewardQuantity: nullableSafeInteger(details.rewardQuantity),
    rewardPercentageBasisPoints: nullableSafeInteger(details.rewardPercentageBasisPoints),
  };
}

function nullableSafeInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if ((typeof value !== "number" && typeof value !== "string") || !Number.isSafeInteger(Number(value))) {
    throw new Error("Unrepresentable retained offer value.");
  }
  return Number(value);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505");
}

function asSafeInteger(value: number | string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed)) {
    throw new Error("Unrepresentable monetary value.");
  }
  return parsed;
}

type SnapshotRow = {
  id: string;
  pricing_version: 1 | null;
  staff_id: string;
  branch_id: string;
  device_id: string;
  issued_at: Date;
  price_fingerprint: string;
  automatic_offers: PriceSnapshotRecord["automaticOffers"];
  coupons: PriceSnapshotRecord["coupons"];
  coupon_accounted_operations: PriceSnapshotRecord["couponAccountedOperations"];
};

export function createPostgresPriceSnapshotStore(queryable: Queryable): PriceSnapshotStore {
  return {
    async insert(input) {
      const fingerprint = input.prices
        .map((price) => `${price.variantId}:${price.listedUnitPricePiasters}`)
        .sort()
        .join("|");
      await queryable.query(
        `INSERT INTO sales_pos_snapshot (
           id, pricing_version, staff_id, branch_id, device_id, issued_at, price_fingerprint, automatic_offers, coupons,
           coupon_accounted_operations
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)`,
        [
          input.id,
          input.pricingVersion,
          input.staffId,
          input.branchId,
          input.deviceId,
          input.issuedAt,
          fingerprint,
          JSON.stringify(input.automaticOffers),
          JSON.stringify(input.coupons),
          JSON.stringify(input.couponAccountedOperations),
        ],
      );
      for (const price of input.prices) {
        await queryable.query(
          `INSERT INTO sales_pos_snapshot_price (
             snapshot_id, variant_id, product_id, category_id, listed_unit_price_piasters
           ) VALUES ($1, $2, $3, $4, $5)`,
          [input.id, price.variantId, price.productId, price.categoryId, price.listedUnitPricePiasters],
        );
      }
      return input;
    },

    async getById(id) {
      const header = await queryable.query<SnapshotRow>(`SELECT * FROM sales_pos_snapshot WHERE id = $1`, [id]);
      const row = header.rows[0];
      if (!row) {
        return null;
      }
      const prices = await queryable.query<{
        variant_id: string;
        product_id: string;
        category_id: string;
        listed_unit_price_piasters: number;
      }>(
        `SELECT variant_id, product_id, category_id, listed_unit_price_piasters
         FROM sales_pos_snapshot_price WHERE snapshot_id = $1`,
        [id],
      );
      return {
        id: row.id,
        pricingVersion: row.pricing_version,
        staffId: row.staff_id,
        branchId: row.branch_id,
        deviceId: row.device_id,
        issuedAt: row.issued_at,
        automaticOffers: row.automatic_offers,
        coupons: row.coupons,
        couponAccountedOperations: row.coupon_accounted_operations,
        prices: prices.rows.map((item) => ({
          variantId: item.variant_id,
          productId: item.product_id,
          categoryId: item.category_id,
          listedUnitPricePiasters: item.listed_unit_price_piasters,
        })),
      };
    },
  };
}

import type { CompletedOperationProofDto, RestoreDeferredSaleDto } from "@bravos/contracts";
import type { Pool, PoolClient } from "pg";
import type { CouponUsageTransaction } from "@bravos/pricing";
import {
  OperationConflictError,
  type InventoryTransaction,
  type StockReconciliationSale,
  type StockReconciliationSalesPort,
} from "@bravos/inventory";
import { normalizeCustomerPhone } from "../domain/customer-phone.ts";
import { SalesValidationError } from "../domain/errors.ts";
import {
  assignedReceiptDocument,
  canonicalReceiptUuid,
  conflictReceiptDocument,
  formatReceiptReference,
  readStoredReceiptIdentity,
  sameAssignedReceiptClaim,
} from "../domain/receipt-number.ts";
import type {
  AutomaticPricingPort,
  DeferredCompletedSalePort,
  ListedPriceReader,
  PricingQuoteReader,
  PriceSnapshotRecord,
  PriceSnapshotStore,
  PhysicalSaleReportingReader,
  PhysicalSaleSourceSearch,
  PhysicalSaleSourceCandidateReader,
  RestoreRuntimePort,
  SaleInsert,
  SaleLineWrite,
  SaleRecord,
  SaleStore,
  SaleUnitWrite,
  SalesTransaction,
  SalesUnitOfWork,
} from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A completed paid sale that arrives while a restore is paused, or that was made under an older
// restore generation, is retained here instead of changing restored stock. A manager recovers it once.
export function createPostgresDeferredCompletedSaleStore(
  pool: Pool,
  restoreFor: (queryable: Queryable) => RestoreRuntimePort,
): DeferredCompletedSalePort {
  return {
    async retainIfRequired(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const runtime = await restoreFor(client).current();
        const sourceGeneration = input.sourceGeneration ?? runtime.generation;
        if (sourceGeneration > runtime.generation) throw new OperationConflictError("جيل الاستعادة المرسل غير صالح.");
        if (sourceGeneration === runtime.generation && !runtime.pause) {
          await client.query("COMMIT");
          return false;
        }
        const applied = await client.query<{ payload_fingerprint: string; physically_completed: boolean }>(
          "SELECT payload_fingerprint, physically_completed FROM sales_sale WHERE operation_id=$1 OR id=$2 FOR UPDATE",
          [input.operationId, input.saleId],
        );
        if (applied.rows[0]?.physically_completed) {
          if (applied.rows[0].payload_fingerprint !== input.payloadFingerprint) throw new OperationConflictError();
          await client.query("COMMIT");
          return false;
        }
        await client.query(
          `INSERT INTO sales_restore_deferred_completion (
             operation_id, sale_id, payload_fingerprint, source_generation, source_device_id,
             original_staff_id, branch_id, occurred_at, payload_json, retained_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now())
           ON CONFLICT DO NOTHING`,
          [input.operationId, input.saleId, input.payloadFingerprint, sourceGeneration, input.sourceDeviceId,
            input.originalStaffId, input.branchId, input.occurredAt, JSON.stringify(input.payload)],
        );
        const retained = await client.query<{
          operation_id: string; sale_id: string; payload_fingerprint: string; source_generation: string | number;
        }>("SELECT operation_id, sale_id, payload_fingerprint, source_generation FROM sales_restore_deferred_completion WHERE operation_id=$1 OR sale_id=$2 FOR UPDATE", [input.operationId, input.saleId]);
        const row = retained.rows[0];
        if (!row || row.operation_id !== input.operationId || row.sale_id !== input.saleId
          || row.payload_fingerprint !== input.payloadFingerprint || Number(row.source_generation) !== sourceGeneration) {
          throw new OperationConflictError();
        }
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    },
    async list() {
      const runtime = await restoreFor(pool).current();
      const result = await pool.query<{
        operation_id: string; sale_id: string; source_generation: string | number;
        source_device_id: string | null; original_staff_id: string; branch_id: string; occurred_at: Date;
        retained_at: Date; status: "pending" | "reconciled";
        payload_json: Record<string, unknown>;
      }>("SELECT * FROM sales_restore_deferred_completion ORDER BY retained_at, operation_id");
      return result.rows.map((row): RestoreDeferredSaleDto => ({
        operationId: row.operation_id, saleId: row.sale_id, sourceGeneration: Number(row.source_generation),
        currentGeneration: runtime.generation, sourceDeviceId: row.source_device_id,
        originalStaffId: row.original_staff_id, branchId: row.branch_id, occurredAt: row.occurred_at.toISOString(),
        retainedAt: row.retained_at.toISOString(), status: row.status,
        recoveryPayload: recoveryPayload(row.payload_json),
      }));
    },
  };
}

function recoveryPayload(value: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...value };
  delete payload.kind;
  delete payload.preparedSale;
  if (value.kind !== "connected") return payload;
  return {
    saleId: payload.saleId,
    operationId: payload.operationId,
    physicallyCompleted: true,
    pendingOperationIds: payload.pendingOperationIds,
    occurredAt: payload.occurredAt,
    restoreGeneration: payload.restoreGeneration,
    ...(payload.payment ? { payment: payload.payment } : {}),
    ...(payload.deviceId !== undefined && payload.deviceId !== null ? { deviceId: payload.deviceId } : {}),
    ...(payload.receiptClaim !== undefined ? { receiptClaim: payload.receiptClaim } : {}),
  };
}

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
  payment_method: "cash" | "online" | "split";
  online_received_piasters: number | string;
  reference: string | null;
  payload_fingerprint: string;
  physically_completed: boolean;
  costs_incomplete: boolean;
  recovered_by_staff_id: string | null;
  recovered_at: Date | null;
  source_device_id: string | null;
  source_snapshot_id: string | null;
  receipt_identity?: unknown;
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
  accepted_minimum_unit_piasters: number | null;
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
        await queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [key]);
      }
    },

    async registerReceiptPrefix(input) {
      const id = input.id.toLowerCase();
      const deviceId = input.deviceId.toLowerCase();
      await queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [id]);
      const existing = await queryable.query<{ id: string; device_id: string; prefix: string }>(
        "SELECT id, device_id, prefix FROM sales_receipt_registration WHERE id = $1",
        [id],
      );
      const row = existing.rows[0];
      if (row) {
        if (row.device_id !== deviceId) {
          throw new SalesValidationError("تسجيل الإيصال لا يطابق هذا الجهاز.");
        }
        return { registrationId: row.id, deviceId: row.device_id, prefix: row.prefix };
      }
      const allocated = await queryable.query<{ prefix: string }>(
        "SELECT nextval('sales_receipt_prefix_seq')::text AS prefix",
      );
      const prefix = allocated.rows[0]?.prefix;
      if (!prefix || !/^[1-9][0-9]*$/.test(prefix)) {
        throw new Error("Receipt prefix sequence is missing.");
      }
      const inserted = await queryable.query<{ id: string; device_id: string; prefix: string }>(
        `INSERT INTO sales_receipt_registration (
           id, device_id, prefix, created_at, created_by_staff_id, restore_generation
         ) VALUES ($1, $2, $3, now(), $4, $5)
         RETURNING id, device_id, prefix`,
        [id, deviceId, prefix, input.staffId, input.restoreGeneration],
      );
      const created = inserted.rows[0];
      if (!created) {
        throw new Error("Receipt registration was not stored.");
      }
      return { registrationId: created.id, deviceId: created.device_id, prefix: created.prefix };
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
             exchange_credit_applied_piasters, cash_received_piasters, payment_method, online_received_piasters,
             coupon_usage_discrepancy_detected_at, coupon_usage_limit, coupon_usage_count_before,
             coupon_usage_actual_count, source_device_id, source_snapshot_id, source_restore_generation
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
             $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34,
              $35, $36, $37, $38, $39, $40, $41, $42,
              $43, $44, $45
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
            input.payment?.cashPiasters ?? input.cashReceivedPiasters ?? input.finalTotalPiasters,
            input.payment?.method ?? "cash",
            input.payment?.onlinePiasters ?? 0,
            input.couponUsageDiscrepancy?.detectedAt ?? null,
            input.couponUsageDiscrepancy?.usageLimit ?? null,
            input.couponUsageDiscrepancy?.countBefore ?? null,
            input.couponUsageDiscrepancy?.actualCount ?? null,
            input.sourceDeviceId ?? null,
            input.sourceSnapshotId ?? null,
            input.sourceRestoreGeneration,
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
        await linkCustomer(queryable, input.id, input.customerName, input.customerPhone, input.soldByStaffId);
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
              coupon_usage_actual_count = COALESCE($10, coupon_usage_actual_count),
              source_restore_generation = COALESCE($11, source_restore_generation),
              payment_method = COALESCE($12, payment_method),
              cash_received_piasters = COALESCE($13, cash_received_piasters),
              online_received_piasters = COALESCE($14, online_received_piasters),
              payload_fingerprint = COALESCE($15, payload_fingerprint)
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
          input.sourceRestoreGeneration ?? null,
          input.payment?.method ?? null,
          input.payment?.cashPiasters ?? null,
          input.payment?.onlinePiasters ?? null,
          input.payloadFingerprint ?? null,
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
    async listDeferredCompletionProofs(operationIds) {
      return loadDeferredCompletionProofs(queryable, operationIds);
    },
    async markRestoreDeferredReconciled(operationId, managerStaffId) {
      await queryable.query(
        `UPDATE sales_restore_deferred_completion
         SET status = 'reconciled', reconciled_by_staff_id = $2, reconciled_at = now()
         WHERE operation_id = $1 AND status = 'pending'`,
        [operationId, managerStaffId],
      );
    },
    async getRestoreDeferredPreparedSale(operationId) {
      const result = await queryable.query<{ prepared: (Omit<SaleInsert, "occurredAt" | "recordedAt"> & {
        occurredAt: string; recordedAt: string | null; sourceRestoreGeneration?: number;
      }) | null; source_generation: string | number }>(
        `SELECT payload_json -> 'preparedSale' AS prepared, source_generation
         FROM sales_restore_deferred_completion WHERE operation_id = $1`,
        [operationId],
      );
      const row = result.rows[0];
      if (!row?.prepared) return null;
      return {
        ...row.prepared,
        occurredAt: new Date(row.prepared.occurredAt),
        recordedAt: row.prepared.recordedAt ? new Date(row.prepared.recordedAt) : null,
        couponUsageDiscrepancy: null,
        physicallyCompleted: false,
        recoveredAt: null,
        recoveredByStaffId: null,
        sourceRestoreGeneration: Number(row.source_generation),
      };
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
    async attachReceiptClaim(input) {
      const locked = await queryable.query<{ receipt_identity: unknown }>(
        `SELECT receipt_identity FROM sales_sale WHERE id = $1 FOR UPDATE`,
        [input.saleId],
      );
      if (!locked.rows[0]) {
        throw new Error("Completed sale is missing for receipt attachment.");
      }
      const stored = readStoredReceiptIdentity(locked.rows[0].receipt_identity);
      if (stored) {
        if (
          stored.status === "assigned"
          && input.claim.kind === "valid"
          && sameAssignedReceiptClaim(stored, input.claim.claim)
        ) {
          return requireLoadedSale(queryable, input.saleId);
        }
        if (stored.status === "assigned" && input.claim.kind !== "absent") {
          await queryable.query(
            `UPDATE sales_sale
             SET receipt_identity = receipt_identity || $2::jsonb
             WHERE id = $1 AND receipt_identity->>'status' = 'assigned'`,
            [input.saleId, JSON.stringify({ numberingConflict: true })],
          );
        }
        return requireLoadedSale(queryable, input.saleId);
      }
      if (input.claim.kind === "absent") {
        return requireLoadedSale(queryable, input.saleId);
      }
      if (input.claim.kind === "malformed") {
        await writeReceiptIdentity(
          queryable,
          input.saleId,
          conflictReceiptDocument(input.claim.claimedReference),
        );
        return requireLoadedSale(queryable, input.saleId);
      }
      const claim = input.claim.claim;
      const registration = await queryable.query<{ device_id: string; prefix: string }>(
        `SELECT device_id, prefix FROM sales_receipt_registration WHERE id = $1`,
        [claim.registrationId],
      );
      const registrationRow = registration.rows[0];
      const sourceDevice = canonicalReceiptUuid(input.sourceDeviceId);
      const registrationDevice = registrationRow ? canonicalReceiptUuid(registrationRow.device_id) : null;
      let canonicalNumber = false;
      try {
        canonicalNumber = formatReceiptReference(claim.prefix, claim.sequence) === claim.reference;
      } catch {
        canonicalNumber = false;
      }
      const assignable = Boolean(
        registrationRow
        && registrationDevice === claim.deviceId
        && registrationRow.prefix === claim.prefix
        && sourceDevice !== null
        && sourceDevice === claim.deviceId
        && canonicalNumber,
      );
      if (!assignable) {
        await writeReceiptIdentity(queryable, input.saleId, conflictReceiptDocument(claim.reference));
        return requireLoadedSale(queryable, input.saleId);
      }
      await queryable.query("SAVEPOINT receipt_identity_attach");
      try {
        await queryable.query(
          `UPDATE sales_sale SET receipt_identity = $2::jsonb WHERE id = $1`,
          [input.saleId, JSON.stringify(assignedReceiptDocument(claim))],
        );
        await queryable.query("RELEASE SAVEPOINT receipt_identity_attach");
      } catch (error) {
        await queryable.query("ROLLBACK TO SAVEPOINT receipt_identity_attach");
        if (!isReceiptIdentityViolation(error)) throw error;
        await writeReceiptIdentity(queryable, input.saleId, conflictReceiptDocument(claim.reference));
      }
      return requireLoadedSale(queryable, input.saleId);
    },
  };
}

export function createPostgresPhysicalSaleReportingReader(queryable: Queryable): PhysicalSaleReportingReader {
  return {
    async countCompletedFacts(input) {
      const result = await queryable.query<{ count: number | string }>(
        `SELECT COUNT(*)::bigint AS count FROM sales_sale
         WHERE physically_completed = true
           AND occurred_at >= $1 AND occurred_at < $2
           AND ($3::uuid IS NULL OR branch_id = $3)
           AND ($4::text IS NULL OR sold_by_staff_id = $4)`,
        [input.from, input.to, input.branchId ?? null, input.employeeId ?? null],
      );
      return asSafeInteger(result.rows[0]?.count ?? 0);
    },
    listCompletedFactsPage(input) {
      return loadMany(
        queryable,
        `SELECT * FROM sales_sale
         WHERE physically_completed = true
           AND occurred_at >= $1 AND occurred_at < $2
           AND ($3::uuid IS NULL OR branch_id = $3)
           AND ($4::text IS NULL OR sold_by_staff_id = $4)
           AND ($5::timestamptz IS NULL OR (occurred_at,id) < ($5,$6::uuid))
         ORDER BY occurred_at DESC, id DESC
         LIMIT $7`,
        [input.from, input.to, input.branchId ?? null, input.employeeId ?? null,
          input.after?.occurredAt ?? null, input.after?.id ?? null, input.limit],
      );
    },
    async getCompletedAttributionsByIds(ids) {
      if (ids.length === 0) return Promise.resolve([]);
      const result = await queryable.query<{
        id: string; branch_id: string; sold_by_staff_id: string; sold_by_display_name: string;
        final_total_piasters: number | string;
      }>(
        `SELECT id,branch_id,sold_by_staff_id,sold_by_display_name,final_total_piasters
         FROM sales_sale WHERE physically_completed = true AND id = ANY($1::uuid[])`,
        [ids],
      );
      return result.rows.map((row) => ({ id: row.id, branchId: row.branch_id,
        soldByStaffId: row.sold_by_staff_id, soldByDisplayName: row.sold_by_display_name,
        finalTotalPiasters: asSafeInteger(row.final_total_piasters) }));
    },
  };
}

export function createPostgresStockReconciliationSales(queryable: Queryable): StockReconciliationSalesPort {
  const toReconciliationSale = async (sale: SaleRecord): Promise<StockReconciliationSale | null> => {
    if (!sale.physicallyCompleted || !sale.recordedAt) return null;
    const snapshot = sale.sourceSnapshotId
      ? await queryable.query<{ issued_at: Date }>(`SELECT issued_at FROM sales_pos_snapshot WHERE id = $1`, [sale.sourceSnapshotId])
      : null;
    return {
      id: sale.id,
      branchId: sale.branchId,
      operationId: sale.operationId,
      sourceDeviceId: sale.sourceDeviceId,
      sourceSnapshotId: sale.sourceSnapshotId,
      sourceSnapshotIssuedAt: snapshot?.rows[0]?.issued_at ?? null,
      occurredAt: sale.occurredAt,
      recordedAt: sale.recordedAt,
      costsIncomplete: sale.costsIncomplete,
      lines: sale.lines.map((line) => ({
        id: line.id,
        variantId: line.variantId,
        quantity: line.quantity,
        allocatedQuantity: line.allocatedQuantity,
        unallocatedQuantity: line.unallocatedQuantity,
      })),
    };
  };
  return {
    async getById(id, lock = false) {
      if (lock) await queryable.query(`SELECT id FROM sales_sale WHERE id = $1 FOR UPDATE`, [id]);
      const sale = await loadById(queryable, id);
      return sale ? await toReconciliationSale(sale) : null;
    },
    async listRecordedAfter(at) {
      const rows = await loadMany(
        queryable,
        `SELECT * FROM sales_sale
         WHERE physically_completed = true AND recorded_at > $1 AND source_device_id IS NOT NULL
         ORDER BY recorded_at, id`,
        [at],
      );
      const projected = await Promise.all(rows.map(toReconciliationSale));
      return projected.filter((row): row is StockReconciliationSale => row !== null);
    },
    async applyAllocatedRemainder(input) {
      let remaining = input.quantity;
      const lines = await queryable.query<{
        id: string;
        unallocated_quantity: number;
      }>(
        `SELECT id, unallocated_quantity
         FROM sales_sale_line
         WHERE sale_id = $1 AND variant_id = $2 AND unallocated_quantity > 0
         ORDER BY line_index, id
         FOR UPDATE`,
        [input.saleId, input.variantId],
      );
      for (const line of lines.rows) {
        if (remaining === 0) break;
        const allocated = Math.min(remaining, line.unallocated_quantity);
        await queryable.query(
          `UPDATE sales_sale_line
           SET allocated_quantity = allocated_quantity + $2,
               unallocated_quantity = unallocated_quantity - $2
           WHERE id = $1`,
          [line.id, allocated],
        );
        remaining -= allocated;
      }
      if (remaining > 0) throw new OperationConflictError("الكمية غير المخصصة لا تطابق واقعة البيع.");
      const state = await queryable.query<{ incomplete: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM sales_sale_line WHERE sale_id = $1 AND unallocated_quantity > 0
         ) AS incomplete`,
        [input.saleId],
      );
      const costsIncomplete = state.rows[0]?.incomplete ?? true;
      await queryable.query(`UPDATE sales_sale SET costs_incomplete = $2 WHERE id = $1`, [input.saleId, costsIncomplete]);
      return { costsIncomplete };
    },
  };
}

export function createPostgresSalesUnitOfWork(
  pool: Pool,
  inventoryFor: (client: PoolClient) => InventoryTransaction,
  couponUsageFor: (client: PoolClient) => CouponUsageTransaction,
  restoreFor: (client: PoolClient) => RestoreRuntimePort,
): SalesUnitOfWork {
  // Business writes enter the restore write barrier. Snapshot issuing is restore control work that
  // stays available during a pause; it reads the generation under the same shared lock instead.
  async function run<T>(work: (tx: SalesTransaction) => Promise<T>, guard: boolean): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (guard) await client.query("SELECT restore_enter_business_write()");
      const result = await work({
        sales: createPostgresSaleStore(client), inventory: inventoryFor(client),
        snapshots: createPostgresPriceSnapshotStore(client), couponUsage: couponUsageFor(client),
        restore: restoreFor(client),
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  return {
    run<T>(work: (tx: SalesTransaction) => Promise<T>) { return run(work, true); },
    runRestoreControl<T>(work: (tx: SalesTransaction) => Promise<T>) { return run(work, false); },
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
         coupon_discount_piasters, employee_discount_piasters, accepted_minimum_unit_piasters,
         allocated_quantity, unallocated_quantity, line_index
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
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
        line.acceptedMinimumUnitPiasters ?? null,
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

async function loadDeferredCompletionProofs(
  queryable: Queryable,
  operationIds: string[],
): Promise<CompletedOperationProofDto[]> {
  const unique = [...new Set(operationIds.filter((id) => UUID_PATTERN.test(id)))];
  if (unique.length === 0) return [];
  const result = await queryable.query<{
    sale_id: string;
    operation_id: string;
    payload_fingerprint: string;
  }>(
    `SELECT sale_id, operation_id, payload_fingerprint
     FROM sales_restore_deferred_completion
     WHERE operation_id = ANY($1::uuid[])`,
    [unique],
  );
  return result.rows
    .filter((row) => typeof row.payload_fingerprint === "string" && /^[0-9a-f]{64}$/i.test(row.payload_fingerprint))
    .map((row) => ({
      operationId: row.operation_id,
      saleId: row.sale_id,
      contentDigest: row.payload_fingerprint,
    }));
}

async function linkCustomer(
  queryable: Queryable,
  saleId: string,
  customerName: string | null,
  customerPhone: string | null,
  actorStaffId: string,
): Promise<void> {
  const phone = normalizeCustomerPhone(customerPhone);
  if (!phone) return;
  const displayName = customerName?.trim() || "بدون اسم";
  await queryable.query(
    `INSERT INTO customer (id, normalized_phone, display_name, created_by_staff_id)
     VALUES (gen_random_uuid(), $1, $2, $3)
     ON CONFLICT (normalized_phone) DO NOTHING`,
    [phone, displayName, actorStaffId],
  );
  const existing = await queryable.query<{ id: string }>(
    `SELECT id FROM customer WHERE normalized_phone = $1`,
    [phone],
  );
  const customerId = existing.rows[0]?.id;
  if (!customerId) return;
  await queryable.query(`UPDATE sales_sale SET customer_id = $2 WHERE id = $1 AND customer_id IS NULL`, [saleId, customerId]);
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
      acceptedMinimumUnitPiasters: row.accepted_minimum_unit_piasters === null
        ? null
        : asSafeInteger(row.accepted_minimum_unit_piasters),
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
    payment: {
      method: row.payment_method ?? "cash",
      cashPiasters: asSafeInteger(row.cash_received_piasters),
      onlinePiasters: asSafeInteger(row.online_received_piasters ?? 0),
    },
    reference: row.reference ?? null,
    payloadFingerprint: row.payload_fingerprint,
    physicallyCompleted: row.physically_completed,
    costsIncomplete: row.costs_incomplete,
    recoveredByStaffId: row.recovered_by_staff_id,
    recoveredAt: row.recovered_at,
    sourceDeviceId: row.source_device_id,
    sourceSnapshotId: row.source_snapshot_id,
    receiptIdentity: readStoredReceiptIdentity(row.receipt_identity),
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

function isReceiptIdentityViolation(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code?: string }).code;
  if (code === "23505" || code === "23514") return true;
  if (code !== "54000") return false;
  const message = "message" in error && typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : "";
  return /index row size/i.test(message)
    || /index row requires .+ maximum size is/i.test(message);
}

async function writeReceiptIdentity(
  queryable: Queryable,
  saleId: string,
  document: { status: "assigned" | "conflict" },
): Promise<void> {
  await queryable.query(
    `UPDATE sales_sale SET receipt_identity = $2::jsonb WHERE id = $1`,
    [saleId, JSON.stringify(document)],
  );
}

async function requireLoadedSale(queryable: Queryable, saleId: string): Promise<SaleRecord> {
  const loaded = await loadById(queryable, saleId);
  if (!loaded) {
    throw new Error("Completed sale is missing for receipt attachment.");
  }
  return loaded;
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
  restore_generation: string | number;
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
           id, pricing_version, staff_id, branch_id, device_id, issued_at, restore_generation, price_fingerprint, automatic_offers, coupons,
           coupon_accounted_operations
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)`,
        [
          input.id,
          input.pricingVersion,
          input.staffId,
          input.branchId,
          input.deviceId,
          input.issuedAt,
          input.restoreGeneration,
          fingerprint,
          JSON.stringify(input.automaticOffers),
          JSON.stringify(input.coupons),
          JSON.stringify(input.couponAccountedOperations),
        ],
      );
      for (const price of input.prices) {
        await queryable.query(
          `INSERT INTO sales_pos_snapshot_price (
             snapshot_id, variant_id, product_id, category_id, listed_unit_price_piasters,
             minimum_unit_price_piasters
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            input.id,
            price.variantId,
            price.productId,
            price.categoryId,
            price.listedUnitPricePiasters,
            price.minimumUnitPricePiasters ?? null,
          ],
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
        minimum_unit_price_piasters: number | null;
      }>(
        `SELECT variant_id, product_id, category_id, listed_unit_price_piasters, minimum_unit_price_piasters
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
        restoreGeneration: Number(row.restore_generation),
        automaticOffers: row.automatic_offers,
        coupons: row.coupons,
        couponAccountedOperations: row.coupon_accounted_operations,
        prices: prices.rows.map((item) => ({
          variantId: item.variant_id,
          productId: item.product_id,
          categoryId: item.category_id,
          listedUnitPricePiasters: item.listed_unit_price_piasters,
          minimumUnitPricePiasters: item.minimum_unit_price_piasters,
        })),
      };
    },
  };
}

export function createPostgresPhysicalSaleSourceCandidateReader(queryable: Queryable): PhysicalSaleSourceCandidateReader {
  return {
    async list(search) {
      const query = sourceSearchQuery(search);
      const result = await queryable.query<{
        id: string;
        received_at_key: string;
        receipt_reference: string | null;
        receipt_numbering_conflict: boolean | null;
      }>(query.sql, query.params);
      return result.rows.map((row) => ({
        id: row.id,
        receivedAtKey: row.received_at_key,
        ...receiptSearchMetadata(row),
      }));
    },
    async projections(ids) {
      if (ids.length === 0) return [];
      const result = await queryable.query<{
        id: string;
        receipt_reference: string | null;
        receipt_numbering_conflict: boolean | null;
      }>(
        `SELECT id,
                NULLIF(receipt_identity->>'reference', '') AS receipt_reference,
                (
                  receipt_identity->>'status' = 'conflict'
                  OR receipt_identity->>'numberingConflict' = 'true'
                ) AS receipt_numbering_conflict
         FROM sales_sale
         WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      return result.rows.map((row) => ({ id: row.id, ...receiptSearchMetadata(row) }));
    },
  };
}

function sourceSearchQuery(search: PhysicalSaleSourceSearch) {
  const params: unknown[] = [];
  const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const where = ["s.physically_completed = true"];
  if (search.reference) {
    const key = bind(search.reference);
    where.push(`(s.reference ILIKE '%' || ${key} || '%' OR s.id::text ILIKE '%' || ${key} || '%' OR s.operation_id::text ILIKE '%' || ${key} || '%' OR COALESCE(s.receipt_identity->>'reference', '') ILIKE '%' || ${key} || '%')`);
  }
  if (search.phone) where.push(`regexp_replace(translate(COALESCE(s.customer_phone,''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g') LIKE '%' || ${bind(search.phone)} || '%'`);
  if (search.date) where.push(`(s.occurred_at AT TIME ZONE 'Africa/Cairo')::date = ${bind(search.date)}::date`);
  if (search.branchId) where.push(`s.branch_id = ${bind(search.branchId)}::uuid`);
  if (search.after) where.push(`(s.occurred_at,s.id,1) < (${bind(search.after.receivedAt)}::timestamptz,${bind(search.after.id)}::uuid,${bind(search.after.channel === "physical" ? 1 : 0)}::int)`);
  const limit = bind(search.limit ?? 100);
  return { sql: `SELECT s.id,
    to_char(s.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_at_key,
    NULLIF(s.receipt_identity->>'reference', '') AS receipt_reference,
    (
      s.receipt_identity->>'status' = 'conflict'
      OR s.receipt_identity->>'numberingConflict' = 'true'
    ) AS receipt_numbering_conflict
    FROM sales_sale s WHERE ${where.join(" AND ")} ORDER BY s.occurred_at DESC,s.id DESC LIMIT ${limit}`, params };
}

function receiptSearchMetadata(row: {
  receipt_reference: string | null;
  receipt_numbering_conflict: boolean | null;
}): { receiptReference?: string; receiptNumberingConflict?: true } {
  return {
    ...(row.receipt_reference ? { receiptReference: row.receipt_reference } : {}),
    ...(row.receipt_numbering_conflict ? { receiptNumberingConflict: true as const } : {}),
  };
}

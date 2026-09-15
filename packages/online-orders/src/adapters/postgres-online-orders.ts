import type { DeliveryAreaDto, OnlineOrderDto, OnlineOrderLineDto } from "@bravos/contracts";
import type { CheckoutQuoteDto, PublicDeliveryAreaDto, PublicOrderSubmissionDto } from "@bravos/contracts/public";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { OnlineOrderValidationError, QuoteAlreadyUsedError } from "../domain/errors.ts";
import type {
  AcceptedOrderWrite,
  CheckoutDependencies,
  DeliveryAreaWrite,
  OnlineOrderStore,
  OnlineOrderUnitOfWork,
  StoredQuote,
} from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;
type AreaRow = {
  id: string;
  name_ar: string;
  fee_piasters: number | string;
  active: boolean;
  changed_by_staff_id: string;
  changed_at: Date;
};
type QuoteRow = {
  id: string;
  request_fingerprint: string;
  request_json: StoredQuote["request"];
  quote_json: CheckoutQuoteDto;
  created_at: Date;
};
type SubmissionRow = {
  id: string;
  operation_id: string;
  payload_fingerprint: string;
  reference: string;
  status: "pending";
  submitted_at: Date;
  quote_json: CheckoutQuoteDto;
};
type OrderRow = {
  id: string;
  operation_id: string;
  reference: string;
  status: "pending";
  customer_name: string;
  primary_phone: string;
  alternate_phone: string | null;
  detailed_address: string;
  landmark: string | null;
  notes: string | null;
  delivery_area_id: string;
  requested_delivery_area_name_ar: string;
  requested_delivery_fee_piasters: number | string;
  requested_coupon_code: string | null;
  requested_merchandise_original_piasters: number | string;
  requested_automatic_offer_discount_piasters: number | string;
  requested_coupon_discount_piasters: number | string;
  requested_merchandise_total_piasters: number | string;
  requested_final_total_piasters: number | string;
  requested_applied_automatic_offer: OnlineOrderDto["requestedAppliedAutomaticOffer"];
  requested_applied_coupon: OnlineOrderDto["requestedAppliedCoupon"];
  submitted_at: Date;
};
type LineRow = {
  id: string;
  variant_id: string;
  product_id: string;
  product_name_ar: string;
  size_name_ar: string;
  color_name_ar: string;
  requested_quantity: number;
  requested_listed_unit_price_piasters: number | string;
  requested_original_piasters: number | string;
  requested_automatic_offer_discount_piasters: number | string;
  requested_coupon_discount_piasters: number | string;
  requested_merchandise_total_piasters: number | string;
};

export function createPostgresOnlineOrderStore(queryable: Queryable): OnlineOrderStore {
  return {
    async listPublicAreas() {
      const rows = await queryable.query<AreaRow>(
        "SELECT * FROM delivery_area WHERE active = true ORDER BY name_ar, id",
      );
      return rows.rows.map(publicArea);
    },
    async listAreas() {
      const rows = await queryable.query<AreaRow>("SELECT * FROM delivery_area ORDER BY name_ar, id");
      return rows.rows.map(area);
    },
    async getArea(id) {
      const result = await queryable.query<AreaRow>("SELECT * FROM delivery_area WHERE id=$1", [id]);
      return result.rows[0] ? area(result.rows[0]) : null;
    },
    async insertArea(input) {
      try {
        const result = await queryable.query<AreaRow>(
          `INSERT INTO delivery_area (id,name_ar,fee_piasters,active,changed_by_staff_id,changed_at)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          areaValues(input),
        );
        return area(required(result.rows[0]));
      } catch (error) { throw mapAreaError(error); }
    },
    async updateArea(input) {
      try {
        const result = await queryable.query<AreaRow>(
          `UPDATE delivery_area SET name_ar=$2,fee_piasters=$3,active=$4,changed_by_staff_id=$5,changed_at=$6
           WHERE id=$1 RETURNING *`,
          areaValues(input),
        );
        return result.rows[0] ? area(result.rows[0]) : null;
      } catch (error) { throw mapAreaError(error); }
    },
    async insertQuote(input) {
      await queryable.query(
        `INSERT INTO online_checkout_quote (id,request_fingerprint,request_json,quote_json,created_at)
         VALUES ($1,$2,$3::jsonb,$4::jsonb,$5)`,
        [input.id, input.requestFingerprint, JSON.stringify(input.request), JSON.stringify(input.quote), input.createdAt],
      );
    },
    async getQuote(id, lock = false) {
      const result = await queryable.query<QuoteRow>(
        `SELECT id,request_fingerprint,request_json,quote_json,created_at FROM online_checkout_quote
         WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
        [id],
      );
      const row = result.rows[0];
      return row ? {
        id: row.id,
        requestFingerprint: row.request_fingerprint,
        request: row.request_json,
        quote: row.quote_json,
        createdAt: row.created_at,
      } : null;
    },
    async getSubmissionByOperation(operationId) {
      const result = await queryable.query<SubmissionRow>(
        `SELECT o.id,o.operation_id,o.payload_fingerprint,o.reference,o.status,o.submitted_at,q.quote_json
         FROM online_order o JOIN online_checkout_quote q ON q.id=o.quote_id WHERE o.operation_id=$1`,
        [operationId],
      );
      const row = result.rows[0];
      return row ? { payloadFingerprint: row.payload_fingerprint, result: publicSubmission(row) } : null;
    },
    async insertOrder(input) {
      try {
        const inserted = await queryable.query<{ reference: string }>(
          `INSERT INTO online_order (
             id,operation_id,payload_fingerprint,quote_id,reference,status,customer_name,primary_phone,
             alternate_phone,detailed_address,landmark,notes,delivery_area_id,requested_delivery_area_name_ar,
             requested_coupon_code,requested_merchandise_original_piasters,
             requested_automatic_offer_discount_piasters,requested_coupon_discount_piasters,
             requested_merchandise_total_piasters,requested_delivery_fee_piasters,requested_final_total_piasters,
             requested_applied_automatic_offer,requested_applied_coupon,submitted_at
           ) VALUES (
             $1,$2,$3,$4,concat('BRV-',lpad(nextval('online_order_reference_number_seq')::text,6,'0')),
             'pending',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb,$22
           ) RETURNING reference`,
          [
            input.id,input.operationId,input.payloadFingerprint,input.quoteId,input.customerName,input.primaryPhone,
            input.alternatePhone,input.detailedAddress,input.landmark,input.notes,input.deliveryAreaId,input.quote.area.nameAr,
            input.couponCode,input.quote.merchandiseOriginalPiasters,input.quote.automaticOfferDiscountPiasters,
            input.quote.couponDiscountPiasters,input.quote.merchandiseTotalPiasters,input.quote.deliveryFeePiasters,
            input.quote.finalTotalPiasters,JSON.stringify(input.quote.appliedAutomaticOffer),
            JSON.stringify(input.quote.appliedCoupon),input.submittedAt,
          ],
        );
        for (const [lineIndex, line] of input.quote.lines.entries()) {
          await queryable.query(
            `INSERT INTO online_order_line (
               id,order_id,variant_id,product_id,product_name_ar,size_name_ar,color_name_ar,requested_quantity,
               requested_listed_unit_price_piasters,requested_original_piasters,
               requested_automatic_offer_discount_piasters,requested_coupon_discount_piasters,
               requested_merchandise_total_piasters,line_index
             ) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [input.id,line.variantId,line.productId,line.productNameAr,line.sizeNameAr,line.colorNameAr,line.quantity,
              line.listedUnitPricePiasters,line.originalPiasters,line.automaticOfferDiscountPiasters,
              line.couponDiscountPiasters,line.merchandiseTotalPiasters,lineIndex],
          );
        }
        return {
          orderId: input.id,
          reference: required(inserted.rows[0]).reference,
          status: "pending",
          submittedAt: input.submittedAt.toISOString(),
          quote: input.quote,
        };
      } catch (error) {
        if (pgCode(error) === "23505" && pgConstraint(error) === "online_order_quote_id_key") throw new QuoteAlreadyUsedError();
        throw error;
      }
    },
    async listOrders() {
      const result = await queryable.query<{ id: string }>("SELECT id FROM online_order ORDER BY submitted_at DESC,id DESC");
      const orders = await Promise.all(result.rows.map((row) => loadOrder(queryable, row.id)));
      return orders.filter((order): order is OnlineOrderDto => order !== null);
    },
    getOrder(id) { return loadOrder(queryable, id); },
  };
}

export function createPostgresOnlineOrderUnitOfWork(
  pool: Pool,
  dependenciesFor: (client: PoolClient) => CheckoutDependencies,
): OnlineOrderUnitOfWork {
  return {
    async run(work, operationId) {
      const client = await pool.connect();
      let operationLocked = false;
      try {
        if (operationId) {
          await client.query("SELECT pg_advisory_lock(hashtextextended($1, 19))", [operationId]);
          operationLocked = true;
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
            const result = await work({ ...dependenciesFor(client), store: createPostgresOnlineOrderStore(client) });
            await client.query("COMMIT");
            return result;
          } catch (error) {
            await client.query("ROLLBACK");
            if (attempt < 2 && retryableTransactionError(error)) continue;
            throw error;
          }
        }
        throw new Error("Online-order transaction retry limit reached.");
      } finally {
        if (operationLocked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 19))", [operationId]);
        client.release();
      }
    },
  };
}

async function loadOrder(queryable: Queryable, id: string): Promise<OnlineOrderDto | null> {
  const result = await queryable.query<OrderRow>("SELECT * FROM online_order WHERE id=$1", [id]);
  const row = result.rows[0];
  if (!row) return null;
  const lineResult = await queryable.query<LineRow>("SELECT * FROM online_order_line WHERE order_id=$1 ORDER BY line_index", [id]);
  return {
    id: row.id, operationId: row.operation_id, reference: row.reference, status: row.status,
    customerName: row.customer_name, primaryPhone: row.primary_phone, alternatePhone: row.alternate_phone,
    detailedAddress: row.detailed_address, landmark: row.landmark, notes: row.notes,
    deliveryArea: { id: row.delivery_area_id, nameAr: row.requested_delivery_area_name_ar, feePiasters: integer(row.requested_delivery_fee_piasters) },
    requestedCouponCode: row.requested_coupon_code,
    requestedMerchandiseOriginalPiasters: integer(row.requested_merchandise_original_piasters),
    requestedAutomaticOfferDiscountPiasters: integer(row.requested_automatic_offer_discount_piasters),
    requestedCouponDiscountPiasters: integer(row.requested_coupon_discount_piasters),
    requestedMerchandiseTotalPiasters: integer(row.requested_merchandise_total_piasters),
    requestedDeliveryFeePiasters: integer(row.requested_delivery_fee_piasters),
    requestedFinalTotalPiasters: integer(row.requested_final_total_piasters),
    requestedAppliedAutomaticOffer: row.requested_applied_automatic_offer,
    requestedAppliedCoupon: row.requested_applied_coupon,
    lines: lineResult.rows.map(lineDto),
    submittedAt: row.submitted_at.toISOString(),
  };
}

function lineDto(row: LineRow): OnlineOrderLineDto {
  return {
    id: row.id, variantId: row.variant_id, productId: row.product_id, productNameAr: row.product_name_ar,
    sizeNameAr: row.size_name_ar, colorNameAr: row.color_name_ar, requestedQuantity: row.requested_quantity,
    requestedListedUnitPricePiasters: integer(row.requested_listed_unit_price_piasters),
    requestedOriginalPiasters: integer(row.requested_original_piasters),
    requestedAutomaticOfferDiscountPiasters: integer(row.requested_automatic_offer_discount_piasters),
    requestedCouponDiscountPiasters: integer(row.requested_coupon_discount_piasters),
    requestedMerchandiseTotalPiasters: integer(row.requested_merchandise_total_piasters),
  };
}

function publicSubmission(row: SubmissionRow): PublicOrderSubmissionDto {
  return { orderId: row.id, reference: row.reference, status: row.status, submittedAt: row.submitted_at.toISOString(), quote: row.quote_json };
}
function area(row: AreaRow): DeliveryAreaDto {
  return { ...publicArea(row), active: row.active, changedByStaffId: row.changed_by_staff_id, changedAt: row.changed_at.toISOString() };
}
function publicArea(row: AreaRow): PublicDeliveryAreaDto {
  return { id: row.id, nameAr: row.name_ar, feePiasters: integer(row.fee_piasters) };
}
function areaValues(input: DeliveryAreaWrite) {
  return [input.id,input.nameAr,input.feePiasters,input.active,input.actorStaffId,input.changedAt];
}
function mapAreaError(error: unknown): never {
  if (pgCode(error) === "23505") throw new OnlineOrderValidationError("اسم منطقة التوصيل مستخدم بالفعل.");
  throw error;
}
function integer(value: number | string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed)) throw new Error("Unrepresentable online-order number.");
  return parsed;
}
function required<T extends QueryResultRow>(row: T | undefined): T {
  if (!row) throw new Error("Expected a PostgreSQL row.");
  return row;
}
function pgCode(error: unknown): string | undefined { return error && typeof error === "object" && "code" in error ? String(error.code) : undefined; }
function pgConstraint(error: unknown): string | undefined { return error && typeof error === "object" && "constraint" in error ? String(error.constraint) : undefined; }
function retryableTransactionError(error: unknown): boolean {
  const code = pgCode(error);
  return code === "40001" || code === "40P01";
}

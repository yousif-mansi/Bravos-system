import type { AutomaticOfferDto } from "@bravos/contracts";
import type { Pool, PoolClient } from "pg";
import type { AutomaticOfferStore, AutomaticOfferWrite } from "../application/ports.ts";
import { evaluateAutomaticOffers, type PricingBasketLine } from "../domain/automatic-offers.ts";
import { PricingValidationError } from "../domain/errors.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;
type OfferRow = {
  id: string;
  name_ar: string;
  discount_type: "percentage" | "fixed";
  percentage_basis_points: number | null;
  fixed_discount_piasters: number | string | null;
  starts_on: Date | string;
  ends_on: Date | string;
  active: boolean;
  allow_coupon: boolean;
  created_by_staff_id: string;
  updated_by_staff_id: string;
  created_at: Date;
  updated_at: Date;
  product_ids: string[];
  category_ids: string[];
};

export function createPostgresAutomaticOfferStore(pool: Pool): AutomaticOfferStore {
  return {
    list: () => loadOffers(pool),
    async getById(id) {
      return (await loadOffers(pool, "o.id = $1", [id]))[0] ?? null;
    },
    async insert(input) {
      return runWrite(pool, async (client) => {
        await client.query(
          `INSERT INTO pricing_automatic_offer (
             id, name_ar, discount_type, percentage_basis_points, fixed_discount_piasters,
             starts_on, ends_on, active, allow_coupon, created_by_staff_id, updated_by_staff_id,
             created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$11)`,
          values(input),
        );
        await replaceScopes(client, input);
        return requiredOffer((await loadOffers(client, "o.id = $1", [input.id]))[0] ?? null);
      });
    },
    async update(input) {
      return runWrite(pool, async (client) => {
        const result = await client.query(
          `UPDATE pricing_automatic_offer SET
             name_ar=$2, discount_type=$3, percentage_basis_points=$4, fixed_discount_piasters=$5,
             starts_on=$6, ends_on=$7, active=$8, allow_coupon=$9,
             updated_by_staff_id=$10, updated_at=$11
           WHERE id=$1 RETURNING id`,
          values(input),
        );
        if (!result.rows[0]) return null;
        await replaceScopes(client, input);
        return requiredOffer((await loadOffers(client, "o.id = $1", [input.id]))[0] ?? null);
      });
    },
  };
}

export function createPostgresAutomaticPricingReader(queryable: Queryable) {
  return {
    async evaluate(lines: PricingBasketLine[], at: Date = new Date()) {
      return evaluateAutomaticOffers({ offers: await loadOffers(queryable), lines, at });
    },
  };
}

async function runWrite<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    if (isPgForeignKeyError(error)) {
      throw new PricingValidationError("المنتج أو التصنيف المحدد غير موجود.");
    }
    throw error;
  } finally {
    client.release();
  }
}

function isPgForeignKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23503";
}

function values(input: AutomaticOfferWrite) {
  return [input.id, input.nameAr, input.discountType, input.percentageBasisPoints,
    input.fixedDiscountPiasters, input.startsOn, input.endsOn, input.active,
    input.allowCoupon, input.actorStaffId, input.changedAt];
}

async function replaceScopes(queryable: Queryable, input: AutomaticOfferWrite) {
  await queryable.query("DELETE FROM pricing_automatic_offer_product WHERE offer_id=$1", [input.id]);
  await queryable.query("DELETE FROM pricing_automatic_offer_category WHERE offer_id=$1", [input.id]);
  for (const productId of input.productIds) {
    await queryable.query("INSERT INTO pricing_automatic_offer_product (offer_id, product_id) VALUES ($1,$2)", [input.id, productId]);
  }
  for (const categoryId of input.categoryIds) {
    await queryable.query("INSERT INTO pricing_automatic_offer_category (offer_id, category_id) VALUES ($1,$2)", [input.id, categoryId]);
  }
}

async function loadOffers(queryable: Queryable, where = "TRUE", params: unknown[] = []): Promise<AutomaticOfferDto[]> {
  const result = await queryable.query<OfferRow>(
    `SELECT o.*,
            ARRAY(SELECT op.product_id FROM pricing_automatic_offer_product op
                  WHERE op.offer_id = o.id ORDER BY op.product_id) AS product_ids,
            ARRAY(SELECT oc.category_id FROM pricing_automatic_offer_category oc
                  WHERE oc.offer_id = o.id ORDER BY oc.category_id) AS category_ids
     FROM pricing_automatic_offer o
     WHERE ${where}
     ORDER BY o.updated_at DESC, o.id`,
    params,
  );
  return result.rows.map((row) => ({
    id: row.id,
    nameAr: row.name_ar,
    discountType: row.discount_type,
    percentageBasisPoints: row.percentage_basis_points,
    fixedDiscountPiasters: row.fixed_discount_piasters === null ? null : safeInteger(row.fixed_discount_piasters),
    startsOn: dateOnly(row.starts_on),
    endsOn: dateOnly(row.ends_on),
    active: row.active,
    allowCoupon: row.allow_coupon,
    productIds: row.product_ids,
    categoryIds: row.category_ids,
    createdByStaffId: row.created_by_staff_id,
    updatedByStaffId: row.updated_by_staff_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

function dateOnly(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function safeInteger(value: number | string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed)) throw new Error("Unrepresentable monetary value.");
  return parsed;
}

function requiredOffer(value: AutomaticOfferDto | null): AutomaticOfferDto {
  if (!value) throw new Error("Saved offer could not be loaded.");
  return value;
}

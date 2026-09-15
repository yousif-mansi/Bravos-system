import type { AutomaticOfferBundleItemDto, AutomaticOfferDiscountType, AutomaticOfferDto, CouponDto } from "@bravos/contracts";
import type { Pool, PoolClient } from "pg";
import type { AutomaticOfferStore, AutomaticOfferWrite, CouponStore, CouponUsageTransaction, CouponWrite } from "../application/ports.ts";
import { evaluateAutomaticOffers, type PricingBasketLine } from "../domain/automatic-offers.ts";
import { evaluateCoupon } from "../domain/coupons.ts";
import { CouponUsageConflictError, PricingValidationError } from "../domain/errors.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;
type OfferRow = {
  id: string;
  name_ar: string;
  discount_type: AutomaticOfferDiscountType;
  percentage_basis_points: number | null;
  fixed_discount_piasters: number | string | null;
  bundle_price_piasters: number | string | null;
  buy_quantity: number | string | null;
  reward_quantity: number | string | null;
  reward_percentage_basis_points: number | null;
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
  bundle_items: Array<{ variantId: string; requiredQuantity: number | string }>;
  buy_product_ids: string[];
  buy_category_ids: string[];
  reward_product_ids: string[];
  reward_category_ids: string[];
};
type CouponRow = {
  id: string;
  code: string;
  discount_type: "percentage" | "fixed";
  percentage_basis_points: number | null;
  fixed_discount_piasters: number | string | null;
  starts_on: Date | string;
  ends_on: Date | string;
  active: boolean;
  allow_automatic_offer: boolean;
  usage_limit: number;
  used_count: number | string;
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
             bundle_price_piasters, buy_quantity, reward_quantity, reward_percentage_basis_points,
             starts_on, ends_on, active, allow_coupon, created_by_staff_id, updated_by_staff_id,
             created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$15)`,
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
             bundle_price_piasters=$6, buy_quantity=$7, reward_quantity=$8,
             reward_percentage_basis_points=$9, starts_on=$10, ends_on=$11, active=$12, allow_coupon=$13,
             updated_by_staff_id=$14, updated_at=$15
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
    async evaluate(lines: PricingBasketLine[], at: Date = new Date(), couponCode: string | null = null) {
      const automatic = evaluateAutomaticOffers({ offers: await loadOffers(queryable), lines, at });
      const coupon = evaluateCoupon({
        coupons: couponCode ? await loadCoupons(queryable) : [],
        code: couponCode,
        lines,
        automaticOffer: automatic.appliedAutomaticOffer,
        automaticRanges: automatic.unitRanges,
        at,
      });
      return { ...automatic, appliedCoupon: coupon.appliedCoupon, couponDiscountPiasters: coupon.couponDiscountPiasters, couponUnitRanges: coupon.unitRanges };
    },
  };
}

export function createPostgresCouponStore(pool: Pool): CouponStore {
  return {
    list: () => loadCoupons(pool),
    async getById(id) { return (await loadCoupons(pool, "c.id = $1", [id]))[0] ?? null; },
    async insert(input) {
      return runWrite(pool, async (client) => {
        await client.query(
          `INSERT INTO pricing_coupon (
             id, code, normalized_code, discount_type, percentage_basis_points, fixed_discount_piasters,
             starts_on, ends_on, active, allow_automatic_offer, usage_limit,
             created_by_staff_id, updated_by_staff_id, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$13)`,
          couponValues(input),
        );
        await replaceCouponScopes(client, input);
        return requiredCoupon((await loadCoupons(client, "c.id = $1", [input.id]))[0] ?? null);
      });
    },
    async update(input) {
      return runWrite(pool, async (client) => {
        const result = await client.query(
          `UPDATE pricing_coupon SET code=$2, normalized_code=$3, discount_type=$4,
             percentage_basis_points=$5, fixed_discount_piasters=$6, starts_on=$7, ends_on=$8,
             active=$9, allow_automatic_offer=$10, usage_limit=$11,
             updated_by_staff_id=$12, updated_at=$13 WHERE id=$1 RETURNING id`,
          couponValues(input),
        );
        if (!result.rows[0]) return null;
        await replaceCouponScopes(client, input);
        return requiredCoupon((await loadCoupons(client, "c.id = $1", [input.id]))[0] ?? null);
      });
    },
  };
}

export function createPostgresCouponUsageTransaction(queryable: Queryable): CouponUsageTransaction {
  return {
    async claim(input) {
      if (await usageWasReplayed(queryable, input)) return "replay";
      const coupon = await queryable.query<{ usage_limit: number }>(
        "SELECT usage_limit FROM pricing_coupon WHERE id=$1 FOR UPDATE",
        [input.couponId],
      );
      const row = coupon.rows[0];
      if (!row) throw new CouponUsageConflictError("الكوبون المقبول لم يعد موجوداً.");
      if (await usageWasReplayed(queryable, input)) return "replay";
      const count = await queryable.query<{ count: number | string }>(
        "SELECT count(*) AS count FROM pricing_coupon_usage WHERE coupon_id=$1 AND released_at IS NULL",
        [input.couponId],
      );
      if (safeInteger(count.rows[0]?.count ?? 0) >= row.usage_limit) throw new CouponUsageConflictError();
      await queryable.query(
        `INSERT INTO pricing_coupon_usage
           (id, coupon_id, source_type, source_id, operation_id, payload_fingerprint, claimed_at)
         VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6)`,
        [input.couponId, input.sourceType, input.sourceId, input.operationId, input.payloadFingerprint, input.claimedAt],
      );
      return "claimed";
    },
  };
}

type CouponUsageIdentity = {
  coupon_id: string;
  source_type: string;
  source_id: string;
  operation_id: string;
  payload_fingerprint: string;
};

async function usageWasReplayed(
  queryable: Queryable,
  input: Parameters<CouponUsageTransaction["claim"]>[0],
): Promise<boolean> {
  const result = await queryable.query<CouponUsageIdentity>(
    `SELECT coupon_id, source_type, source_id, operation_id, payload_fingerprint
     FROM pricing_coupon_usage
     WHERE operation_id=$1 OR (source_type=$2 AND source_id=$3)`,
    [input.operationId, input.sourceType, input.sourceId],
  );
  if (result.rows.length === 0) return false;
  if (result.rows.length === 1) {
    const existing = result.rows[0];
    if (existing && existing.coupon_id === input.couponId && existing.source_type === input.sourceType
      && existing.source_id === input.sourceId && existing.operation_id === input.operationId
      && existing.payload_fingerprint === input.payloadFingerprint) return true;
  }
  throw new CouponUsageConflictError("أُعيد استخدام معرّف الكوبون ببيانات مختلفة.");
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
    if (isPgUniqueError(error)) throw new PricingValidationError("كود الكوبون مستخدم بالفعل.");
    throw error;
  } finally {
    client.release();
  }
}

function isPgUniqueError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function isPgForeignKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23503";
}

function values(input: AutomaticOfferWrite) {
  return [input.id, input.nameAr, input.discountType, input.percentageBasisPoints,
    input.fixedDiscountPiasters, input.bundlePricePiasters, input.buyQuantity,
    input.rewardQuantity, input.rewardPercentageBasisPoints, input.startsOn, input.endsOn,
    input.active, input.allowCoupon, input.actorStaffId, input.changedAt];
}

function couponValues(input: CouponWrite) {
  return [input.id, input.code, input.normalizedCode, input.discountType, input.percentageBasisPoints,
    input.fixedDiscountPiasters, input.startsOn, input.endsOn, input.active, input.allowAutomaticOffer,
    input.usageLimit, input.actorStaffId, input.changedAt];
}

async function replaceScopes(queryable: Queryable, input: AutomaticOfferWrite) {
  await queryable.query("DELETE FROM pricing_automatic_offer_product WHERE offer_id=$1", [input.id]);
  await queryable.query("DELETE FROM pricing_automatic_offer_category WHERE offer_id=$1", [input.id]);
  await queryable.query("DELETE FROM pricing_automatic_offer_bundle_item WHERE offer_id=$1", [input.id]);
  await queryable.query("DELETE FROM pricing_automatic_offer_buy_product WHERE offer_id=$1", [input.id]);
  await queryable.query("DELETE FROM pricing_automatic_offer_buy_category WHERE offer_id=$1", [input.id]);
  await queryable.query("DELETE FROM pricing_automatic_offer_reward_product WHERE offer_id=$1", [input.id]);
  await queryable.query("DELETE FROM pricing_automatic_offer_reward_category WHERE offer_id=$1", [input.id]);
  for (const productId of input.productIds) {
    await queryable.query("INSERT INTO pricing_automatic_offer_product (offer_id, product_id) VALUES ($1,$2)", [input.id, productId]);
  }
  for (const categoryId of input.categoryIds) {
    await queryable.query("INSERT INTO pricing_automatic_offer_category (offer_id, category_id) VALUES ($1,$2)", [input.id, categoryId]);
  }
  for (const item of input.bundleItems) {
    await queryable.query(
      "INSERT INTO pricing_automatic_offer_bundle_item (offer_id, variant_id, required_quantity) VALUES ($1,$2,$3)",
      [input.id, item.variantId, item.requiredQuantity],
    );
  }
  for (const productId of input.buyProductIds) {
    await queryable.query("INSERT INTO pricing_automatic_offer_buy_product (offer_id, product_id) VALUES ($1,$2)", [input.id, productId]);
  }
  for (const categoryId of input.buyCategoryIds) {
    await queryable.query("INSERT INTO pricing_automatic_offer_buy_category (offer_id, category_id) VALUES ($1,$2)", [input.id, categoryId]);
  }
  for (const productId of input.rewardProductIds) {
    await queryable.query("INSERT INTO pricing_automatic_offer_reward_product (offer_id, product_id) VALUES ($1,$2)", [input.id, productId]);
  }
  for (const categoryId of input.rewardCategoryIds) {
    await queryable.query("INSERT INTO pricing_automatic_offer_reward_category (offer_id, category_id) VALUES ($1,$2)", [input.id, categoryId]);
  }
}

async function replaceCouponScopes(queryable: Queryable, input: CouponWrite) {
  await queryable.query("DELETE FROM pricing_coupon_product WHERE coupon_id=$1", [input.id]);
  await queryable.query("DELETE FROM pricing_coupon_category WHERE coupon_id=$1", [input.id]);
  for (const productId of input.productIds) await queryable.query("INSERT INTO pricing_coupon_product (coupon_id, product_id) VALUES ($1,$2)", [input.id, productId]);
  for (const categoryId of input.categoryIds) await queryable.query("INSERT INTO pricing_coupon_category (coupon_id, category_id) VALUES ($1,$2)", [input.id, categoryId]);
}

async function loadOffers(queryable: Queryable, where = "TRUE", params: unknown[] = []): Promise<AutomaticOfferDto[]> {
  const result = await queryable.query<OfferRow>(
    `SELECT o.*,
            ARRAY(SELECT op.product_id FROM pricing_automatic_offer_product op
                  WHERE op.offer_id = o.id ORDER BY op.product_id) AS product_ids,
            ARRAY(SELECT oc.category_id FROM pricing_automatic_offer_category oc
                  WHERE oc.offer_id = o.id ORDER BY oc.category_id) AS category_ids
            ,ARRAY(SELECT jsonb_build_object(
                    'variantId', bi.variant_id,
                    'requiredQuantity', bi.required_quantity
                  )
                  FROM pricing_automatic_offer_bundle_item bi
                  WHERE bi.offer_id = o.id ORDER BY bi.variant_id) AS bundle_items
            ,ARRAY(SELECT bp.product_id FROM pricing_automatic_offer_buy_product bp
                  WHERE bp.offer_id = o.id ORDER BY bp.product_id) AS buy_product_ids
            ,ARRAY(SELECT bc.category_id FROM pricing_automatic_offer_buy_category bc
                  WHERE bc.offer_id = o.id ORDER BY bc.category_id) AS buy_category_ids
            ,ARRAY(SELECT rp.product_id FROM pricing_automatic_offer_reward_product rp
                  WHERE rp.offer_id = o.id ORDER BY rp.product_id) AS reward_product_ids
            ,ARRAY(SELECT rc.category_id FROM pricing_automatic_offer_reward_category rc
                  WHERE rc.offer_id = o.id ORDER BY rc.category_id) AS reward_category_ids
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
    bundlePricePiasters: row.bundle_price_piasters === null ? null : safeInteger(row.bundle_price_piasters),
    bundleItems: row.bundle_items.map(toBundleItem),
    buyQuantity: row.buy_quantity === null ? null : safeInteger(row.buy_quantity),
    rewardQuantity: row.reward_quantity === null ? null : safeInteger(row.reward_quantity),
    rewardPercentageBasisPoints: row.reward_percentage_basis_points,
    buyProductIds: row.buy_product_ids,
    buyCategoryIds: row.buy_category_ids,
    rewardProductIds: row.reward_product_ids,
    rewardCategoryIds: row.reward_category_ids,
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

async function loadCoupons(queryable: Queryable, where = "TRUE", params: unknown[] = []): Promise<CouponDto[]> {
  const result = await queryable.query<CouponRow>(
    `SELECT c.*,
            ARRAY(SELECT cp.product_id FROM pricing_coupon_product cp WHERE cp.coupon_id=c.id ORDER BY cp.product_id) AS product_ids,
            ARRAY(SELECT cc.category_id FROM pricing_coupon_category cc WHERE cc.coupon_id=c.id ORDER BY cc.category_id) AS category_ids,
            (SELECT count(*) FROM pricing_coupon_usage cu WHERE cu.coupon_id=c.id AND cu.released_at IS NULL) AS used_count
     FROM pricing_coupon c WHERE ${where} ORDER BY c.updated_at DESC, c.id`,
    params,
  );
  return result.rows.map((row) => ({
    id: row.id, code: row.code, discountType: row.discount_type,
    percentageBasisPoints: row.percentage_basis_points,
    fixedDiscountPiasters: row.fixed_discount_piasters === null ? null : safeInteger(row.fixed_discount_piasters),
    startsOn: dateOnly(row.starts_on), endsOn: dateOnly(row.ends_on), active: row.active,
    allowAutomaticOffer: row.allow_automatic_offer, usageLimit: row.usage_limit,
    usedCount: safeInteger(row.used_count), productIds: row.product_ids, categoryIds: row.category_ids,
    createdByStaffId: row.created_by_staff_id, updatedByStaffId: row.updated_by_staff_id,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
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

function toBundleItem(value: { variantId: string; requiredQuantity: number | string }): AutomaticOfferBundleItemDto {
  return { variantId: value.variantId, requiredQuantity: safeInteger(value.requiredQuantity) };
}

function requiredOffer(value: AutomaticOfferDto | null): AutomaticOfferDto {
  if (!value) throw new Error("Saved offer could not be loaded.");
  return value;
}

function requiredCoupon(value: CouponDto | null): CouponDto {
  if (!value) throw new Error("Saved coupon could not be loaded.");
  return value;
}

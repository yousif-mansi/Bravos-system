import type { PoolClient } from "pg";
import type { AutomaticOfferWrite, CouponWrite, OpeningPricingTransaction } from "../application/ports.ts";

export function createPostgresOpeningPricingTransaction(client: PoolClient): OpeningPricingTransaction {
  return {
    async inspectOpeningPricing(input) {
      const [offers, coupons] = await Promise.all([
        client.query<{ id: string; name_ar: string }>("SELECT id,name_ar FROM pricing_automatic_offer ORDER BY id"),
        client.query<{ id: string; normalized_code: string }>("SELECT id,normalized_code FROM pricing_coupon ORDER BY id"),
      ]);
      const offerNames = new Set(offers.rows.map((row) => normalize(row.name_ar)));
      const couponCodes = new Set(coupons.rows.map((row) => row.normalized_code));
      return {
        state: { offers: offers.rows, coupons: coupons.rows },
        errors: [
          ...input.offers
            .filter((row) => offerNames.has(normalize(row.nameAr)))
            .map((row) => ({ file: "configuration.csv" as const, line: row.line, column: "name_ar", code: "COLLISION", messageAr: "اسم العرض موجود بالفعل." })),
          ...input.coupons
            .filter((row) => couponCodes.has(row.normalizedCode))
            .map((row) => ({ file: "configuration.csv" as const, line: row.line, column: "name_ar", code: "COLLISION", messageAr: "كود الكوبون موجود بالفعل." })),
        ],
      };
    },
    async insertOpeningPricing(input) {
      for (const offer of input.offers) {
        await client.query(`INSERT INTO pricing_automatic_offer (
          id,name_ar,discount_type,percentage_basis_points,fixed_discount_piasters,bundle_price_piasters,
          buy_quantity,reward_quantity,reward_percentage_basis_points,starts_on,ends_on,active,allow_coupon,
          created_by_staff_id,updated_by_staff_id,created_at,updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::date,$12,$13,$14,$14,$15,$15)`, offerValues(offer));
        await insertOfferScopes(client, offer);
      }
      for (const coupon of input.coupons) {
        await client.query(`INSERT INTO pricing_coupon (
          id,code,normalized_code,discount_type,percentage_basis_points,fixed_discount_piasters,
          starts_on,ends_on,active,allow_automatic_offer,usage_limit,created_by_staff_id,updated_by_staff_id,created_at,updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12,$12,$13,$13)`, couponValues(coupon));
        for (const id of coupon.productIds) await client.query("INSERT INTO pricing_coupon_product (coupon_id,product_id) VALUES ($1,$2)",[coupon.id,id]);
        for (const id of coupon.categoryIds) await client.query("INSERT INTO pricing_coupon_category (coupon_id,category_id) VALUES ($1,$2)",[coupon.id,id]);
      }
    },
  };
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ar-EG");
}

function offerValues(input: AutomaticOfferWrite) { return [input.id,input.nameAr,input.discountType,input.percentageBasisPoints,input.fixedDiscountPiasters,input.bundlePricePiasters,input.buyQuantity,input.rewardQuantity,input.rewardPercentageBasisPoints,input.startsOn,input.endsOn,input.active,input.allowCoupon,input.actorStaffId,input.changedAt]; }
function couponValues(input: CouponWrite) { return [input.id,input.code,input.normalizedCode,input.discountType,input.percentageBasisPoints,input.fixedDiscountPiasters,input.startsOn,input.endsOn,input.active,input.allowAutomaticOffer,input.usageLimit,input.actorStaffId,input.changedAt]; }
async function insertOfferScopes(client: PoolClient,input:AutomaticOfferWrite){
  for(const id of input.productIds)await client.query("INSERT INTO pricing_automatic_offer_product (offer_id,product_id) VALUES ($1,$2)",[input.id,id]);
  for(const id of input.categoryIds)await client.query("INSERT INTO pricing_automatic_offer_category (offer_id,category_id) VALUES ($1,$2)",[input.id,id]);
  for(const item of input.bundleItems)await client.query("INSERT INTO pricing_automatic_offer_bundle_item (offer_id,variant_id,required_quantity) VALUES ($1,$2,$3)",[input.id,item.variantId,item.requiredQuantity]);
  for(const id of input.buyProductIds)await client.query("INSERT INTO pricing_automatic_offer_buy_product (offer_id,product_id) VALUES ($1,$2)",[input.id,id]);
  for(const id of input.buyCategoryIds)await client.query("INSERT INTO pricing_automatic_offer_buy_category (offer_id,category_id) VALUES ($1,$2)",[input.id,id]);
  for(const id of input.rewardProductIds)await client.query("INSERT INTO pricing_automatic_offer_reward_product (offer_id,product_id) VALUES ($1,$2)",[input.id,id]);
  for(const id of input.rewardCategoryIds)await client.query("INSERT INTO pricing_automatic_offer_reward_category (offer_id,category_id) VALUES ($1,$2)",[input.id,id]);
}

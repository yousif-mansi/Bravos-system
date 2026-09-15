import type { PoolClient } from "pg";
import type { OpeningCatalogPlan, OpeningCatalogTransaction } from "../application/ports.ts";

export function createPostgresOpeningCatalogTransaction(client: PoolClient): OpeningCatalogTransaction {
  return {
    async inspect(plan) {
      const stateResult = await client.query<{
        categories: unknown; sizes: unknown; colors: unknown; products: unknown; variants: unknown;
      }>(`SELECT
        COALESCE((SELECT jsonb_agg(jsonb_build_array(id,name_ar,parent_id) ORDER BY id) FROM catalog_category),'[]') AS categories,
        COALESCE((SELECT jsonb_agg(jsonb_build_array(id,name_ar) ORDER BY id) FROM catalog_size),'[]') AS sizes,
        COALESCE((SELECT jsonb_agg(jsonb_build_array(id,name_ar) ORDER BY id) FROM catalog_color),'[]') AS colors,
        COALESCE((SELECT jsonb_agg(jsonb_build_array(id,code,name_ar,category_id,default_selling_price_piasters,publication,updated_at) ORDER BY id) FROM catalog_product),'[]') AS products,
        COALESCE((SELECT jsonb_agg(jsonb_build_array(id,product_id,size_id,color_id,selling_price_piasters_override,updated_at) ORDER BY id) FROM catalog_product_variant),'[]') AS variants`);
      const errors: Awaited<ReturnType<OpeningCatalogTransaction["inspect"]>>["errors"] = [];
      const [categoryNames, sizeNames, colorNames, productCodes] = await Promise.all([
        client.query<{ name_ar: string; parent_id: string | null }>("SELECT name_ar,parent_id FROM catalog_category"),
        client.query<{ name_ar: string }>("SELECT name_ar FROM catalog_size"),
        client.query<{ name_ar: string }>("SELECT name_ar FROM catalog_color"),
        client.query<{ code: string }>("SELECT code FROM catalog_product"),
      ]);
      const existingCategories = new Set(categoryNames.rows.map((row) => `${row.parent_id ?? "root"}:${normalize(row.name_ar)}`));
      const existingSizes = new Set(sizeNames.rows.map((row) => normalize(row.name_ar)));
      const existingColors = new Set(colorNames.rows.map((row) => normalize(row.name_ar)));
      const existingCodes = new Set(productCodes.rows.map((row) => normalize(row.code)));
      for (const value of plan.categories) if (existingCategories.has(`${value.parentId ?? "root"}:${normalize(value.nameAr)}`)) errors.push(collision(value.line, "name_ar", "التصنيف موجود بالفعل تحت الأب نفسه."));
      for (const value of plan.sizes) if (existingSizes.has(normalize(value.nameAr))) errors.push(collision(value.line, "name_ar", "المقاس موجود بالفعل."));
      for (const value of plan.colors) if (existingColors.has(normalize(value.nameAr))) errors.push(collision(value.line, "name_ar", "اللون موجود بالفعل."));
      for (const value of plan.products) if (existingCodes.has(normalize(value.code))) errors.push(collision(value.line, "product_code", "كود المنتج موجود بالفعل."));
      await verifyIds(client,"catalog_product_variant",plan.referencedVariants,errors);
      await verifyIds(client,"catalog_product",plan.referencedProducts,errors);
      await verifyIds(client,"catalog_category",plan.referencedCategories,errors);
      await verifyIds(client,"catalog_size",plan.referencedSizes,errors);
      await verifyIds(client,"catalog_color",plan.referencedColors,errors);
      for (const variant of plan.variants) {
        const duplicate = await client.query("SELECT 1 FROM catalog_product_variant WHERE product_id=$1 AND size_id=$2 AND color_id=$3",[variant.productId,variant.sizeId,variant.colorId]);
        if (duplicate.rows[0]) errors.push(collision(variant.line,"key","متغير المنتج بالمقاس واللون نفسه موجود بالفعل."));
      }
      return { state: stateResult.rows[0] ?? {}, errors };
    },
    async insert(plan, actorStaffId, at) {
      const remaining = new Map(plan.categories.map((row) => [row.id, row]));
      while (remaining.size > 0) {
        let inserted = 0;
        for (const [id, row] of [...remaining]) {
          if (row.parentId && remaining.has(row.parentId)) continue;
          await client.query("INSERT INTO catalog_category (id,name_ar,parent_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$4)", [id,row.nameAr,row.parentId,at]);
          remaining.delete(id); inserted += 1;
        }
        if (inserted === 0) throw new Error("Circular category references in opening import.");
      }
      for (const row of plan.sizes) await client.query("INSERT INTO catalog_size (id,name_ar,created_at,updated_at) VALUES ($1,$2,$3,$3)",[row.id,row.nameAr,at]);
      for (const row of plan.colors) await client.query("INSERT INTO catalog_color (id,name_ar,created_at,updated_at) VALUES ($1,$2,$3,$3)",[row.id,row.nameAr,at]);
      for (const row of plan.products) await client.query(`INSERT INTO catalog_product (id,code,name_ar,description_ar,category_id,default_selling_price_piasters,publication,image_refs,size_guide_ar,created_by_staff_id,last_changed_by_staff_id,last_changed_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$10,$11,$11,$11)`,[row.id,row.code,row.nameAr,row.descriptionAr,row.categoryId,row.defaultSellingPricePiasters,row.publication,JSON.stringify(row.imageRefs),row.sizeGuideAr,actorStaffId,at]);
      for (const row of plan.variants) await client.query("INSERT INTO catalog_product_variant (id,product_id,size_id,color_id,selling_price_piasters_override,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)",[row.id,row.productId,row.sizeId,row.colorId,row.sellingPricePiastersOverride,at]);
    },
  };
}

function normalize(value: string) { return value.trim().toLocaleLowerCase("ar-EG"); }
function collision(line: number, column: string, messageAr: string) { return { file: "catalog.csv" as const, line, column, code: "COLLISION", messageAr }; }
async function verifyIds(
  client: PoolClient,
  table: string,
  references: OpeningCatalogPlan["referencedVariants"],
  errors: Awaited<ReturnType<OpeningCatalogTransaction["inspect"]>>["errors"],
) {
  if (references.length === 0) return;
  const ids = [...new Set(references.map((reference) => reference.id))];
  const result = await client.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE id=ANY($1::uuid[])`,
    [ids],
  );
  const found = new Set(result.rows.map((row) => row.id));
  for (const reference of references) {
    if (!found.has(reference.id)) {
      errors.push({
        file: reference.file,
        line: reference.line,
        column: reference.column,
        code: "UNKNOWN_REFERENCE",
        messageAr: `المرجع الصريح id:${reference.id} غير موجود.`,
      });
    }
  }
}

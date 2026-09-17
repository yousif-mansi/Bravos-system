import type {
  CategoryDto,
  ColorDto,
  ManagerProductDto,
  ManagerVariantDto,
  SizeDto,
  VariantIdentityDto,
} from "@bravos/contracts";
import type { Pool, PoolClient } from "pg";
import { CatalogValidationError, DuplicateProductCodeError, ReferencedVariantError } from "../domain/errors.ts";
import { resolvedSellingPricePiasters } from "../domain/money.ts";
import type { PublicationStatus } from "../domain/product.ts";
import type { CatalogStore, ProductWrite } from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;

type CategoryRow = {
  id: string;
  name_ar: string;
  parent_id: string | null;
};

type NamedRow = {
  id: string;
  name_ar: string;
};

type ProductRow = {
  id: string;
  code: string;
  name_ar: string;
  description_ar: string;
  category_id: string;
  category_name_ar: string;
  category_parent_id: string | null;
  default_selling_price_piasters: number;
  publication: PublicationStatus;
  image_refs: unknown;
  size_guide_ar: string | null;
  last_changed_by_staff_id: string | null;
  last_changed_at: Date;
};

type VariantRow = {
  id: string;
  product_id: string;
  size_id: string;
  size_name_ar: string;
  color_id: string;
  color_name_ar: string;
  selling_price_piasters_override: number | null;
};

type VariantIdentityRow = {
  id: string;
  product_id: string;
  product_code: string;
  product_name_ar: string;
  size_id: string;
  size_name_ar: string;
  color_id: string;
  color_name_ar: string;
};

type ProductJoinRow = ProductRow & {
  variant_id: string | null;
  size_id: string | null;
  size_name_ar: string | null;
  color_id: string | null;
  color_name_ar: string | null;
  selling_price_piasters_override: number | null;
};

export function createPostgresCatalogStore(pool: Pool): CatalogStore {
  return {
    async listCategories() {
      const result = await pool.query<CategoryRow>(
        `SELECT id, name_ar, parent_id FROM catalog_category ORDER BY parent_id NULLS FIRST, name_ar`,
      );
      return result.rows.map(toCategory);
    },

    async getCategory(id) {
      const result = await pool.query<CategoryRow>(
        `SELECT id, name_ar, parent_id FROM catalog_category WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      return row ? toCategory(row) : null;
    },

    async createCategory(input) {
      try {
        const result = await pool.query<CategoryRow>(
          `INSERT INTO catalog_category (id, name_ar, parent_id)
           VALUES (gen_random_uuid(), $1, $2)
           RETURNING id, name_ar, parent_id`,
          [input.nameAr, input.parentId],
        );
        return toCategory(mustRow(result.rows[0]));
      } catch (error) {
        throw mapUniqueName(error, "اسم التصنيف مستخدم بالفعل.");
      }
    },

    async updateCategory(id, nameAr) {
      try {
        const result = await pool.query<CategoryRow>(
          `UPDATE catalog_category
           SET name_ar = $2, updated_at = now()
           WHERE id = $1
           RETURNING id, name_ar, parent_id`,
          [id, nameAr],
        );
        const row = result.rows[0];
        return row ? toCategory(row) : null;
      } catch (error) {
        throw mapUniqueName(error, "اسم التصنيف مستخدم بالفعل.");
      }
    },

    async listSizes() {
      const result = await pool.query<NamedRow>(`SELECT id, name_ar FROM catalog_size ORDER BY name_ar`);
      return result.rows.map(toSize);
    },

    async getSize(id) {
      const result = await pool.query<NamedRow>(`SELECT id, name_ar FROM catalog_size WHERE id = $1`, [id]);
      const row = result.rows[0];
      return row ? toSize(row) : null;
    },

    async createSize(nameAr) {
      try {
        const result = await pool.query<NamedRow>(
          `INSERT INTO catalog_size (id, name_ar) VALUES (gen_random_uuid(), $1) RETURNING id, name_ar`,
          [nameAr],
        );
        return toSize(mustRow(result.rows[0]));
      } catch (error) {
        throw mapUniqueName(error, "اسم المقاس مستخدم بالفعل.");
      }
    },

    async updateSize(id, nameAr) {
      try {
        const result = await pool.query<NamedRow>(
          `UPDATE catalog_size SET name_ar = $2, updated_at = now() WHERE id = $1 RETURNING id, name_ar`,
          [id, nameAr],
        );
        const row = result.rows[0];
        return row ? toSize(row) : null;
      } catch (error) {
        throw mapUniqueName(error, "اسم المقاس مستخدم بالفعل.");
      }
    },

    async listColors() {
      const result = await pool.query<NamedRow>(`SELECT id, name_ar FROM catalog_color ORDER BY name_ar`);
      return result.rows.map(toColor);
    },

    async getColor(id) {
      const result = await pool.query<NamedRow>(`SELECT id, name_ar FROM catalog_color WHERE id = $1`, [id]);
      const row = result.rows[0];
      return row ? toColor(row) : null;
    },

    async createColor(nameAr) {
      try {
        const result = await pool.query<NamedRow>(
          `INSERT INTO catalog_color (id, name_ar) VALUES (gen_random_uuid(), $1) RETURNING id, name_ar`,
          [nameAr],
        );
        return toColor(mustRow(result.rows[0]));
      } catch (error) {
        throw mapUniqueName(error, "اسم اللون مستخدم بالفعل.");
      }
    },

    async updateColor(id, nameAr) {
      try {
        const result = await pool.query<NamedRow>(
          `UPDATE catalog_color SET name_ar = $2, updated_at = now() WHERE id = $1 RETURNING id, name_ar`,
          [id, nameAr],
        );
        const row = result.rows[0];
        return row ? toColor(row) : null;
      } catch (error) {
        throw mapUniqueName(error, "اسم اللون مستخدم بالفعل.");
      }
    },

    async listProducts() {
      return loadProducts(pool, "TRUE");
    },

    async listPublishedProducts() {
      return loadProducts(pool, "p.publication IN ('available', 'coming_soon')");
    },

    async getProduct(id) {
      const products = await loadProducts(pool, "p.id = $1", [id]);
      return products[0] ?? null;
    },

    async getPublishedProduct(id) {
      const products = await loadProducts(
        pool,
        "p.id = $1 AND p.publication IN ('available', 'coming_soon')",
        [id],
      );
      return products[0] ?? null;
    },

    async findProductByCodeKey(codeKey) {
      const products = await loadProducts(pool, "lower(btrim(p.code)) = $1", [codeKey]);
      return products[0] ?? null;
    },

    async isMediaPublic(ref) {
      const result = await pool.query<{ found: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM catalog_product
           WHERE publication IN ('available', 'coming_soon')
             AND image_refs ? $1
         ) AS found`,
        [ref],
      );
      return result.rows[0]?.found === true;
    },

    async getVariants(ids) {
      return getVariantIdentities(pool, ids);
    },

    async getListedPrices(ids) {
      return loadListedPrices(pool, ids);
    },

    async listVariantIds() {
      return listVariantIdentityIds(pool);
    },

    async createProduct(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT restore_enter_business_write()");
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO catalog_product (
             id, code, name_ar, description_ar, category_id,
             default_selling_price_piasters, publication, image_refs, size_guide_ar,
             created_by_staff_id, last_changed_by_staff_id, last_changed_at
           ) VALUES (
             gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $9, now()
           ) RETURNING id`,
          [
            input.code,
            input.nameAr,
            input.descriptionAr,
            input.categoryId,
            input.defaultSellingPricePiasters,
            input.publication,
            JSON.stringify(input.imageRefs),
            input.sizeGuideAr,
            input.actorStaffId,
          ],
        );
        const productId = mustRow(inserted.rows[0]).id;
        await replaceVariants(client, productId, input.variants);
        const product = await loadProduct(client, productId);
        if (!product) {
          throw new Error("Created catalog product could not be loaded.");
        }
        await client.query("COMMIT");
        return product;
      } catch (error) {
        await client.query("ROLLBACK");
        throw mapProductWriteError(error);
      } finally {
        client.release();
      }
    },

    async updateProduct(id, input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT restore_enter_business_write()");
        const updated = await client.query<{ id: string }>(
          `UPDATE catalog_product
           SET code = $2,
               name_ar = $3,
               description_ar = $4,
               category_id = $5,
               default_selling_price_piasters = $6,
               publication = $7,
               image_refs = $8::jsonb,
               size_guide_ar = $9,
               last_changed_by_staff_id = $10,
               last_changed_at = now(),
               updated_at = now()
           WHERE id = $1
           RETURNING id`,
          [
            id,
            input.code,
            input.nameAr,
            input.descriptionAr,
            input.categoryId,
            input.defaultSellingPricePiasters,
            input.publication,
            JSON.stringify(input.imageRefs),
            input.sizeGuideAr,
            input.actorStaffId,
          ],
        );
        if (!updated.rows[0]) {
          await client.query("ROLLBACK");
          return null;
        }
        await replaceVariants(client, id, input.variants);
        const product = await loadProduct(client, id);
        if (!product) {
          throw new Error("Updated catalog product could not be loaded.");
        }
        await client.query("COMMIT");
        return product;
      } catch (error) {
        await client.query("ROLLBACK");
        throw mapProductWriteError(error);
      } finally {
        client.release();
      }
    },
  };
}

export function createPostgresCatalogReportingReader(queryable: Queryable): Pick<CatalogStore, "getVariants" | "listVariantIds"> {
  return {
    getVariants: (ids) => getVariantIdentities(queryable, ids),
    listVariantIds: () => listVariantIdentityIds(queryable),
  };
}

async function getVariantIdentities(queryable: Queryable, ids: string[]) {
  if (ids.length === 0) return [];
  const result = await queryable.query<VariantIdentityRow>(
    `SELECT v.id, p.id AS product_id, p.code AS product_code, p.name_ar AS product_name_ar,
            s.id AS size_id, s.name_ar AS size_name_ar,
            col.id AS color_id, col.name_ar AS color_name_ar
     FROM catalog_product_variant v
     JOIN catalog_product p ON p.id = v.product_id
     JOIN catalog_size s ON s.id = v.size_id
     JOIN catalog_color col ON col.id = v.color_id
     WHERE v.id = ANY($1::uuid[])`,
    [ids],
  );
  return result.rows.map(toVariantIdentity);
}

async function listVariantIdentityIds(queryable: Queryable) {
  const result = await queryable.query<{ id: string }>(`SELECT id FROM catalog_product_variant ORDER BY id`);
  return result.rows.map((row) => row.id);
}

export function createPostgresListedPriceReader(queryable: Queryable): Pick<CatalogStore, "getListedPrices"> {
  return { getListedPrices: (ids) => loadListedPrices(queryable, ids) };
}

export function createPostgresCheckoutCatalogReader(queryable: Queryable) {
  return {
    async getLines(ids: string[]) {
      if (ids.length === 0) return [];
      const result = await queryable.query<VariantIdentityRow & {
        category_id: string;
        default_selling_price_piasters: number | string;
        selling_price_piasters_override: number | string | null;
        publication: "available" | "coming_soon" | "hidden";
      }>(
        `SELECT v.id, p.id AS product_id, p.code AS product_code, p.name_ar AS product_name_ar,
                s.id AS size_id, s.name_ar AS size_name_ar,
                col.id AS color_id, col.name_ar AS color_name_ar,
                p.category_id, p.default_selling_price_piasters, v.selling_price_piasters_override,
                p.publication
         FROM catalog_product_variant v
         JOIN catalog_product p ON p.id = v.product_id
         JOIN catalog_size s ON s.id = v.size_id
         JOIN catalog_color col ON col.id = v.color_id
         WHERE v.id = ANY($1::uuid[])`,
        [ids],
      );
      return result.rows.map((row) => ({
        variantId: row.id,
        productId: row.product_id,
        categoryId: row.category_id,
        productNameAr: row.product_name_ar,
        sizeNameAr: row.size_name_ar,
        colorNameAr: row.color_name_ar,
        listedUnitPricePiasters: resolvedSellingPricePiasters(
          asSafeInteger(row.default_selling_price_piasters),
          row.selling_price_piasters_override === null ? null : asSafeInteger(row.selling_price_piasters_override),
        ),
        publication: row.publication,
      }));
    },
  };
}

async function loadListedPrices(queryable: Queryable, ids: string[]) {
  if (ids.length === 0) return [];
  const result = await queryable.query<VariantIdentityRow & {
    category_id: string;
    default_selling_price_piasters: number;
    selling_price_piasters_override: number | null;
  }>(
    `SELECT v.id, p.id AS product_id, p.code AS product_code, p.name_ar AS product_name_ar,
            s.id AS size_id, s.name_ar AS size_name_ar,
            col.id AS color_id, col.name_ar AS color_name_ar,
            p.category_id, p.default_selling_price_piasters, v.selling_price_piasters_override
     FROM catalog_product_variant v
     JOIN catalog_product p ON p.id = v.product_id
     JOIN catalog_size s ON s.id = v.size_id
     JOIN catalog_color col ON col.id = v.color_id
     WHERE v.id = ANY($1::uuid[])`,
    [ids],
  );
  return result.rows.map((row) => ({
    variantId: row.id,
    productId: row.product_id,
    categoryId: row.category_id,
    listedUnitPricePiasters: resolvedSellingPricePiasters(
      row.default_selling_price_piasters,
      row.selling_price_piasters_override,
    ),
    identity: toVariantIdentity(row),
  }));
}

async function replaceVariants(
  client: PoolClient,
  productId: string,
  variants: ProductWrite["variants"],
): Promise<void> {
  const existing = await client.query<{ id: string; size_id: string; color_id: string }>(
    `SELECT id, size_id, color_id FROM catalog_product_variant WHERE product_id = $1`,
    [productId],
  );
  const keep = new Set<string>();
  for (const variant of variants) {
    const match = existing.rows.find(
      (row) => row.size_id === variant.sizeId && row.color_id === variant.colorId,
    );
    if (match) {
      keep.add(match.id);
      await client.query(
        `UPDATE catalog_product_variant
         SET selling_price_piasters_override = $2, updated_at = now()
         WHERE id = $1`,
        [match.id, variant.sellingPricePiastersOverride],
      );
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO catalog_product_variant (
           id, product_id, size_id, color_id, selling_price_piasters_override
         ) VALUES (gen_random_uuid(), $1, $2, $3, $4)
         RETURNING id`,
        [productId, variant.sizeId, variant.colorId, variant.sellingPricePiastersOverride],
      );
      keep.add(mustRow(inserted.rows[0]).id);
    }
  }
  const stale = existing.rows.filter((row) => !keep.has(row.id)).map((row) => row.id);
  if (stale.length > 0) {
    await client.query(`DELETE FROM catalog_product_variant WHERE id = ANY($1::uuid[])`, [stale]);
  }
}

async function loadProduct(queryable: Queryable, id: string): Promise<ManagerProductDto | null> {
  const products = await loadProducts(queryable, "p.id = $1", [id]);
  return products[0] ?? null;
}

async function loadProducts(
  queryable: Queryable,
  where: string,
  params: unknown[] = [],
): Promise<ManagerProductDto[]> {
  const result = await queryable.query<ProductJoinRow>(
    `${productJoinSelect()} WHERE ${where} ORDER BY p.code, s.name_ar, col.name_ar`,
    params,
  );
  return foldProducts(result.rows);
}

function foldProducts(rows: ProductJoinRow[]): ManagerProductDto[] {
  const order: string[] = [];
  const grouped = new Map<string, { row: ProductRow; variants: ManagerVariantDto[] }>();
  for (const row of rows) {
    let group = grouped.get(row.id);
    if (!group) {
      group = { row, variants: [] };
      grouped.set(row.id, group);
      order.push(row.id);
    }
    if (row.variant_id && row.size_id && row.color_id && row.size_name_ar && row.color_name_ar) {
      group.variants.push(
        toVariant(
          {
            id: row.variant_id,
            product_id: row.id,
            size_id: row.size_id,
            size_name_ar: row.size_name_ar,
            color_id: row.color_id,
            color_name_ar: row.color_name_ar,
            selling_price_piasters_override: row.selling_price_piasters_override,
          },
          row.default_selling_price_piasters,
        ),
      );
    }
  }
  return order.map((id) => {
    const group = grouped.get(id);
    if (!group) {
      throw new Error("Expected a catalog product group.");
    }
    return toProduct(group.row, group.variants);
  });
}

function productJoinSelect(): string {
  return `SELECT
     p.id,
     p.code,
     p.name_ar,
     p.description_ar,
     p.category_id,
     c.name_ar AS category_name_ar,
     c.parent_id AS category_parent_id,
     p.default_selling_price_piasters,
     p.publication,
     p.image_refs,
     p.size_guide_ar,
     p.last_changed_by_staff_id,
     p.last_changed_at,
     v.id AS variant_id,
     v.size_id,
     s.name_ar AS size_name_ar,
     v.color_id,
     col.name_ar AS color_name_ar,
     v.selling_price_piasters_override
   FROM catalog_product p
   JOIN catalog_category c ON c.id = p.category_id
   LEFT JOIN catalog_product_variant v ON v.product_id = p.id
   LEFT JOIN catalog_size s ON s.id = v.size_id
   LEFT JOIN catalog_color col ON col.id = v.color_id`;
}

function toCategory(row: CategoryRow): CategoryDto {
  return { id: row.id, nameAr: row.name_ar, parentId: row.parent_id };
}

function toSize(row: NamedRow): SizeDto {
  return { id: row.id, nameAr: row.name_ar };
}

function toColor(row: NamedRow): ColorDto {
  return { id: row.id, nameAr: row.name_ar };
}

function toVariant(row: VariantRow, defaultSellingPricePiasters: number): ManagerVariantDto {
  return {
    id: row.id,
    size: { id: row.size_id, nameAr: row.size_name_ar },
    color: { id: row.color_id, nameAr: row.color_name_ar },
    sellingPricePiastersOverride: row.selling_price_piasters_override,
    sellingPricePiasters: resolvedSellingPricePiasters(
      defaultSellingPricePiasters,
      row.selling_price_piasters_override,
    ),
  };
}

function toProduct(row: ProductRow, variants: ManagerVariantDto[]): ManagerProductDto {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    descriptionAr: row.description_ar,
    category: {
      id: row.category_id,
      nameAr: row.category_name_ar,
      parentId: row.category_parent_id,
    },
    defaultSellingPricePiasters: row.default_selling_price_piasters,
    publication: row.publication,
    imageRefs: Array.isArray(row.image_refs) ? row.image_refs.map((item) => String(item)) : [],
    sizeGuideAr: row.size_guide_ar,
    variants,
    changedByStaffId: row.last_changed_by_staff_id,
    changedAt: row.last_changed_at.toISOString(),
  };
}

function mapUniqueName(error: unknown, messageAr: string): never {
  if (isUniqueViolation(error)) {
    throw new CatalogValidationError(messageAr);
  }
  throw error;
}

function mapProductWriteError(error: unknown): never {
  if (
    error instanceof CatalogValidationError ||
    error instanceof DuplicateProductCodeError ||
    error instanceof ReferencedVariantError
  ) {
    throw error;
  }
  if (isUniqueViolation(error, "catalog_product_code")) {
    throw new DuplicateProductCodeError();
  }
  if (isUniqueViolation(error, "catalog_product_variant_unique")) {
    throw new CatalogValidationError("لا يمكن تكرار نفس المقاس واللون.");
  }
  if (
    isForeignKeyViolation(error, "inventory_batch_variant_fk") ||
    isForeignKeyViolation(error, "receiving_receipt_line_variant_fk") ||
    isForeignKeyViolation(error, "inventory_movement_variant_fk") ||
    isForeignKeyViolation(error, "inventory_allocation_variant_fk") ||
    isForeignKeyViolation(error, "inventory_discrepancy_variant_fk") ||
    isForeignKeyViolation(error, "sales_sale_line_variant_fk")
  ) {
    throw new ReferencedVariantError();
  }
  if (isUniqueViolation(error)) {
    throw new CatalogValidationError("تركيبة المقاس واللون غير صالحة.");
  }
  throw error;
}

function toVariantIdentity(row: VariantIdentityRow): VariantIdentityDto {
  return {
    id: row.id,
    product: {
      id: row.product_id,
      code: row.product_code,
      nameAr: row.product_name_ar,
    },
    size: { id: row.size_id, nameAr: row.size_name_ar },
    color: { id: row.color_id, nameAr: row.color_name_ar },
  };
}

function isUniqueViolation(error: unknown, constraint?: string): boolean {
  return isPgCode(error, "23505", constraint);
}

function isForeignKeyViolation(error: unknown, constraint?: string): boolean {
  return isPgCode(error, "23503", constraint);
}

function isPgCode(error: unknown, code: string, constraint?: string): boolean {
  if (!error || typeof error !== "object" || !("code" in error) || (error as { code?: string }).code !== code) {
    return false;
  }
  if (!constraint) {
    return true;
  }
  return (error as { constraint?: string }).constraint === constraint;
}

function mustRow<T>(row: T | undefined): T {
  if (!row) {
    throw new Error("Expected a database row.");
  }
  return row;
}

function asSafeInteger(value: number | string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed)) throw new Error("Unrepresentable catalog monetary value.");
  return parsed;
}

import type { BackupTableSnapshot } from "@bravos/contracts";
import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: T[] }>;
};

const TABLES: ReadonlyArray<{ tableName: string; orderBy: string; where?: string }> = [
  { tableName: "pricing_automatic_offer", orderBy: "id" },
  { tableName: "pricing_automatic_offer_product", orderBy: "offer_id, product_id" },
  { tableName: "pricing_automatic_offer_category", orderBy: "offer_id, category_id" },
  { tableName: "pricing_automatic_offer_bundle_item", orderBy: "offer_id, variant_id" },
  { tableName: "pricing_automatic_offer_buy_product", orderBy: "offer_id, product_id" },
  { tableName: "pricing_automatic_offer_buy_category", orderBy: "offer_id, category_id" },
  { tableName: "pricing_automatic_offer_reward_product", orderBy: "offer_id, product_id" },
  { tableName: "pricing_automatic_offer_reward_category", orderBy: "offer_id, category_id" },
  { tableName: "pricing_coupon", orderBy: "id" },
  { tableName: "pricing_coupon_product", orderBy: "coupon_id, product_id" },
  { tableName: "pricing_coupon_category", orderBy: "coupon_id, category_id" },
  { tableName: "pricing_coupon_usage", orderBy: "id" },
];

export function createPostgresPricingBackupReader(queryable: Queryable) {
  return {
    async readBackupTables(): Promise<BackupTableSnapshot[]> {
      const result: BackupTableSnapshot[] = [];
      for (const table of TABLES) {
        const where = table.where ? ` WHERE ${table.where}` : "";
        const rows = await queryable.query<Record<string, unknown>>(
          `SELECT * FROM ${table.tableName}${where} ORDER BY ${table.orderBy}`,
        );
        result.push({ tableName: table.tableName, rows: rows.rows });
      }
      return result;
    },
  };
}

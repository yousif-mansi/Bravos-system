import type { Pool, PoolClient } from "pg";
import type { CustomerDirectory, CustomerListQuery, CustomerRecord, PhysicalPaidPurchase } from "../application/ports.ts";

type Queryable = Pick<Pool, "query"> | PoolClient;

const PHONE_FOLD = `regexp_replace(translate(COALESCE(s.customer_phone, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g')`;

function quantity(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("تعذر قراءة كمية مشترية.");
  }
  return parsed;
}

export function createPostgresCustomerDirectory(queryable: Queryable): CustomerDirectory {
  return {
    async findByPhone(normalizedPhone) {
      const result = await queryable.query<{ id: string; normalized_phone: string; display_name: string }>(
        `SELECT id, normalized_phone, display_name FROM customer WHERE normalized_phone = $1`,
        [normalizedPhone],
      );
      const row = result.rows[0];
      return row ? toCustomer(row) : null;
    },
    async getById(id) {
      const result = await queryable.query<{ id: string; normalized_phone: string; display_name: string }>(
        `SELECT id, normalized_phone, display_name FROM customer WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      return row ? toCustomer(row) : null;
    },
    async list(input: CustomerListQuery) {
      const pattern = `%${input.query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      const result = await queryable.query<{ id: string; normalized_phone: string; display_name: string }>(
        `SELECT id, normalized_phone, display_name
         FROM customer
         WHERE (
           $1 = ''
           OR display_name ILIKE $2 ESCAPE '\\'
           OR ($3 <> '' AND normalized_phone LIKE '%' || $3 || '%')
         )
         AND (
           $4::text IS NULL
           OR display_name > $4
           OR (display_name = $4 AND id > $5::uuid)
         )
         ORDER BY display_name, id
         LIMIT $6`,
        [
          input.query,
          pattern,
          input.digits,
          input.after?.displayName ?? null,
          input.after?.id ?? null,
          input.limit,
        ],
      );
      return result.rows.map(toCustomer);
    },
    async listPhysicalPurchases(customer, from, to) {
      const result = await queryable.query<{
        id: string;
        reference: string;
        occurred_at: Date;
        variant_id: string;
        quantity: number | string;
        line_index: number;
      }>(
        `SELECT s.id,
                COALESCE(NULLIF(s.receipt_identity->>'reference', ''), s.reference, s.id::text) AS reference,
                s.occurred_at,
                line.variant_id,
                line.quantity,
                line.line_index
         FROM sales_sale s
         JOIN sales_sale_line line ON line.sale_id = s.id
         WHERE s.physically_completed = true
           AND (s.occurred_at AT TIME ZONE 'Africa/Cairo') >= $4::date
           AND (s.occurred_at AT TIME ZONE 'Africa/Cairo') < $5::date
           AND (
             s.customer_id = $1::uuid
             OR (
               s.customer_id IS NULL
               AND (
                 SELECT CASE
                   WHEN digits ~ '^20[0-9]{10}$' THEN '0' || substring(digits FROM 3)
                   ELSE digits
                 END
                 FROM (SELECT ${PHONE_FOLD} AS digits) raw
               ) = $2
               AND (
                 btrim(COALESCE(s.customer_name, '')) = ''
                 OR btrim(s.customer_name) = btrim($3)
               )
             )
           )
         ORDER BY s.occurred_at DESC, s.id DESC, line.line_index`,
        [customer.id, customer.normalizedPhone, customer.displayName, from, to],
      );
      const purchases = new Map<string, PhysicalPaidPurchase>();
      for (const row of result.rows) {
        let purchase = purchases.get(row.id);
        if (!purchase) {
          purchase = {
            sourceId: row.id,
            reference: row.reference,
            paidAt: row.occurred_at,
            lines: [],
          };
          purchases.set(row.id, purchase);
        }
        purchase.lines.push({ variantId: row.variant_id, quantity: quantity(row.quantity) });
      }
      return [...purchases.values()];
    },
  };
}

function toCustomer(row: { id: string; normalized_phone: string; display_name: string }): CustomerRecord {
  return { id: row.id, normalizedPhone: row.normalized_phone, displayName: row.display_name };
}

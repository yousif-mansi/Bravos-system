import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool, "query"> | PoolClient;

export type PaidOnlinePurchase = {
  sourceId: string;
  reference: string;
  paidAt: Date;
  products: Array<{ nameAr: string; optionText: string | null; quantity: number }>;
};

export type PaidOnlinePurchaseReader = {
  listDeliveredPurchases(normalizedPhone: string, from: string, to: string): Promise<PaidOnlinePurchase[]>;
};

const PHONE_FOLD = `regexp_replace(translate(COALESCE(order_row.primary_phone, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g')`;
const HIDDEN_OPTION = new Set(["internal-operational-size", "internal-operational-color"]);

type StoredLine = {
  nameAr?: unknown;
  sizeNameAr?: unknown;
  colorNameAr?: unknown;
  quantity?: unknown;
};

export function createPostgresPaidOnlinePurchaseReader(queryable: Queryable): PaidOnlinePurchaseReader {
  return {
    async listDeliveredPurchases(normalizedPhone, from, to) {
      const result = await queryable.query<{
        id: string;
        reference: string;
        occurred_at: Date;
        confirmed_quote_json: unknown;
        lines: StoredLine[] | null;
      }>(
        `SELECT order_row.id,
                order_row.reference,
                event.occurred_at,
                confirmation.confirmed_quote_json,
                COALESCE(
                  json_agg(
                    json_build_object(
                      'nameAr', line.product_name_ar,
                      'sizeNameAr', line.size_name_ar,
                      'colorNameAr', line.color_name_ar,
                      'quantity', line.requested_quantity
                    )
                    ORDER BY line.line_index
                  ) FILTER (WHERE line.id IS NOT NULL),
                  '[]'
                ) AS lines
         FROM online_order order_row
         JOIN online_order_confirmation confirmation ON confirmation.order_id = order_row.id
         JOIN LATERAL (
           SELECT occurred_at
           FROM online_order_fulfillment_event
           WHERE order_id = order_row.id AND event_type = 'delivered'
           ORDER BY occurred_at DESC, id DESC
           LIMIT 1
         ) event ON true
         LEFT JOIN online_order_line line ON line.order_id = order_row.id
         WHERE order_row.status = 'delivered'
           AND (event.occurred_at AT TIME ZONE 'Africa/Cairo') >= $2::date
           AND (event.occurred_at AT TIME ZONE 'Africa/Cairo') < $3::date
           AND (
             SELECT CASE
               WHEN digits ~ '^20[0-9]{10}$' THEN '0' || substring(digits FROM 3)
               ELSE digits
             END
             FROM (SELECT ${PHONE_FOLD} AS digits) raw
           ) = $1
         GROUP BY order_row.id, order_row.reference, event.occurred_at, confirmation.confirmed_quote_json
         ORDER BY event.occurred_at DESC, order_row.id DESC`,
        [normalizedPhone, from, to],
      );
      return result.rows.map((row) => ({
        sourceId: row.id,
        reference: row.reference,
        paidAt: row.occurred_at,
        products: productsFromQuote(row.confirmed_quote_json) ?? productsFromLines(row.lines ?? []),
      }));
    },
  };
}

function productsFromQuote(quote: unknown): PaidOnlinePurchase["products"] | null {
  if (!quote || typeof quote !== "object" || !("lines" in quote) || !Array.isArray(quote.lines)) return null;
  const products: PaidOnlinePurchase["products"] = [];
  for (const line of quote.lines) {
    const product = productFrom(line);
    if (product) products.push(product);
  }
  return products;
}

function productsFromLines(lines: StoredLine[]): PaidOnlinePurchase["products"] {
  return lines.flatMap((line) => {
    const product = productFrom(line);
    return product ? [product] : [];
  });
}

function productFrom(line: unknown): PaidOnlinePurchase["products"][number] | null {
  if (!line || typeof line !== "object") return null;
  const row = line as StoredLine & { productNameAr?: unknown };
  const quantity = typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
  const named = typeof row.productNameAr === "string" ? row.productNameAr.trim() : "";
  const nameAr = named || (typeof row.nameAr === "string" ? row.nameAr.trim() : "");
  if (!nameAr || !Number.isSafeInteger(quantity) || quantity <= 0) return null;
  return {
    nameAr,
    optionText: optionText(row.sizeNameAr, row.colorNameAr),
    quantity,
  };
}

function optionText(size: unknown, color: unknown): string | null {
  const parts = [size, color]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && !HIDDEN_OPTION.has(value));
  return parts.length > 0 ? parts.join(" / ") : null;
}

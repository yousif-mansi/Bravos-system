import { RestoreValidationError } from "./errors.ts";

export type RestoreTables = Map<string, Array<Record<string, unknown>>>;

// Links that PostgreSQL foreign keys cannot express on their own: both directions of the
// receipt-line/batch pair, batch variants used by stock effects, and polymorphic coupon sources.
export function assertCrossFeatureLinks(data: RestoreTables): void {
  const batches = indexRows(data, "inventory_batch", "id");
  const receiptLines = indexRows(data, "receiving_receipt_line", "id");
  for (const line of receiptLines.values()) {
    const batch = batches.get(textField(line, "batch_id"));
    if (!batch || batch.source_line_id !== line.id || batch.variant_id !== line.variant_id) {
      throw new RestoreValidationError("تحتوي النسخة على سطر استلام لا يطابق دفعة المخزون المرتبطة به.");
    }
  }
  for (const batch of batches.values()) {
    if (batch.source_line_id === null || batch.source_line_id === undefined) continue;
    const line = receiptLines.get(textField(batch, "source_line_id"));
    if (!line || line.batch_id !== batch.id || line.variant_id !== batch.variant_id) {
      throw new RestoreValidationError("تحتوي النسخة على دفعة مخزون بلا سطر استلام مطابق.");
    }
  }

  const corrections = indexRows(data, "inventory_stock_correction", "id");
  for (const effect of data.get("inventory_stock_correction_batch") ?? []) {
    assertBatchVariant(corrections.get(textField(effect, "correction_id")), batches.get(textField(effect, "batch_id")));
  }
  const reconciliations = indexRows(data, "inventory_stock_reconciliation", "id");
  for (const effect of data.get("inventory_stock_reconciliation_batch") ?? []) {
    assertBatchVariant(reconciliations.get(textField(effect, "reconciliation_id")), batches.get(textField(effect, "batch_id")));
  }
  for (const restoration of data.get("returns_batch_restoration") ?? []) {
    assertBatchVariant(restoration, batches.get(textField(restoration, "batch_id")));
  }

  const sales = indexRows(data, "sales_sale", "id");
  const orders = indexRows(data, "online_order", "id");
  for (const usage of data.get("pricing_coupon_usage") ?? []) {
    const sourceId = textField(usage, "source_id");
    const exists = usage.source_type === "physical_sale" ? sales.has(sourceId)
      : usage.source_type === "online_order" ? orders.has(sourceId) : false;
    if (!exists) throw new RestoreValidationError("تحتوي النسخة على استخدام كوبون بلا بيع أو طلب مطابق.");
  }
}

function assertBatchVariant(owner: Record<string, unknown> | undefined, batch: Record<string, unknown> | undefined) {
  if (!owner || !batch || owner.variant_id !== batch.variant_id) {
    throw new RestoreValidationError("تحتوي النسخة على أثر مخزون مرتبط بدفعة متغير آخر.");
  }
}

function indexRows(data: RestoreTables, tableName: string, key: string) {
  const indexed = new Map<string, Record<string, unknown>>();
  for (const row of data.get(tableName) ?? []) indexed.set(textField(row, key), row);
  return indexed;
}

function textField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new RestoreValidationError("تحتوي النسخة على رابط سجل غير صالح.");
  }
  return value;
}

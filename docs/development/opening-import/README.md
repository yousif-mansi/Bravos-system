# Opening import launch files

These CSV files initialize current catalog, stock cost batches, and operating configuration. They never import old paper sales history. The `*.example.csv` files are labeled local-development examples only; do not load them as production data.

Use UTF-8 CSV with the exact template headers. Quoted fields may contain commas, quotes, Arabic text, and newlines. Each file is limited to 1 MiB, all three files together are limited to 5,000 data rows, and a field is limited to 4,000 characters. EGP values accept at most two decimal places. Quantities and batch order are positive integers. Dates use `YYYY-MM-DD`.

The three files are always submitted together. A header-only file is valid when that section is unused. The manager reviews an immutable preview, including every cost batch and each current-to-proposed singleton setting, before explicit acceptance. Any validation or business-key collision blocks acceptance. If relevant catalog, stock, or configuration state changes after preview, create a fresh preview.

Keys identify rows within the import and are normalized case-insensitively. The prefix `id:` is reserved. Reference fields accept either an import key or an explicit existing identity such as `id:123e4567-e89b-42d3-a456-426614174000`. This permits a header-only catalog file with opening stock for variants already entered in the application. The importer never guesses an existing entity from a mutable name or code and never overwrites an existing catalog/configuration row silently.

## Catalog rows

- `category`: requires `key`, `name_ar`; `parent_key` is optional.
- `size` and `color`: require `key`, `name_ar`.
- `product`: requires `key`, `name_ar`, `product_code`, `category_key`, `default_price_egp`, and `publication` (`available`, `coming_soon`, or `hidden`). Image references are separated with `|`; the import does not copy image binaries.
- `variant`: requires `key`, `product_key`, `size_key`, and `color_key`; `price_override_egp` is optional.

## Opening stock rows

Every row requires `batch_key`, `branch_code`, `variant_key`, `quantity`, `unit_cost_egp`, `receipt_date`, and `batch_order`. Separate rows remain separate FIFO cost batches. FIFO order is the receipt date, then the declared batch order, then the stable batch identity. Batch order must be unique per variant. Acceptance creates one receiving record for each branch represented in the stock rows, labeled by its Cairo acceptance date. These are opening-import audit records, not a claim that the historical batches were received together. Each inventory batch keeps its own supplied receipt date and declared FIFO order for costing and later corrections.

Management reports show accepted opening-import stock apart from ordinary purchases. The report date on those receipts is the Cairo acceptance date. Batch dates and FIFO order stay on the CSV values. Opening value is an opening balance: it is neither a new purchase nor an operating expense, and it does not change sales, profit, inventory quantities, or FIFO. Purchase and opening totals cover every branch and ignore the sales branch, employee, and channel filters. A configuration-only accepted import, or an unaccepted preview, does not classify a later ordinary receipt as opening stock.

## Configuration rows

Supported types are `inventory_default_threshold`, `variant_low_stock_threshold`, `expense_category`, `delivery_area`, `storefront_contact`, `online_order_settings`, `automatic_offer`, `bundle_item`, and `coupon`. Automatic offers support the same live application types: `percentage`, `fixed`, `fixed_bundle`, and `buy_x_get_y`. Pipe-separated product/category scope columns accept import keys or explicit `id:<UUID>` references. A `fixed_bundle` uses separate `bundle_item` rows with `offer_key`, `variant_key`, and `required_quantity`. Buy-X-Get-Y uses the explicit buy/reward scope columns and quantities; no new pricing rule is introduced by import.

Offer `key` values are import-local references. The live collision identity is the normalized Arabic offer name; an import refuses a name already present instead of updating it. Coupon collision identity is its normalized code.

Before launch, replace examples with the actual BRAVOS product/category/variant list, batch quantities/costs/order, expense categories, delivery areas and fees, contacts, low-stock thresholds, pending-order policy, offers, and coupons. Verify the accepted import in internal catalog, inventory, receiving, pricing, and order settings before enabling public ordering.

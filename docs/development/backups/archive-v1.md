# BRAVOS business backup archive v1

The download starts with the 16 ASCII bytes `BRAVOS-BACKUP\n1\n`. The remainder is canonical UTF-8 JSON containing a versioned encrypted envelope. Binary envelope values use unpadded base64url.

Version 1 derives a 32-byte key with Node's maintained `crypto.scrypt` implementation using a fresh 16-byte random salt and the fixed, bounded parameters `N=32768`, `r=8`, `p=1`, `maxmem=67108864`. It encrypts canonical manifest/data JSON with AES-256-GCM, a fresh 12-byte nonce, a required 16-byte authentication tag and the canonical envelope header as additional authenticated data. Decoding rejects any other parameters before running the KDF. Both production and decoding enforce a 192 MiB maximum on the complete archive. Production calculates the exact canonical plaintext and base64url-envelope byte lengths before allocating the ciphertext or envelope, so it cannot emit a download that its decoder rejects for size. Node's primary documentation recommends a unique random salt of at least 16 bytes for scrypt and documents that GCM authentication failure is reported by `decipher.final()`: [Node.js v22 crypto documentation](https://nodejs.org/docs/latest-v22.x/api/crypto.html).

The encrypted payload contains manifest format `bravos-business-data` version 1, the exact applied migration filename, a stable backup UUID and creator staff ID, stock version, online-order/POS-sale/return reference sequence states, per-section table counts and SHA-256 checksums, and stable database rows. Current backups include independent batch/branch balances, completed-sale payment allocations, readable references and online confirmation/reversal facts. `decodeBackupArchive(bytes, password)` authenticates the envelope and validates the complete table allowlist, section checksums/counts, total count and sanitized actor projection before returning data to restore. Decoding an older recognized profile does not make it compatible with the current restore target.

The identity section contains `identity_actor`, a projection without email, password hashes, provider credentials or authentication metadata. Session, account, verification, active-branch session and recovery-challenge tables are excluded. Accepted opening-import previews are retained; invalid and unaccepted previews are transient. Catalog image-reference strings are retained without image binaries. Known unsynchronized till rows are recorded as a warning and the manifest explicitly says unsent browser records are not included.

## Version 1 table allowlist

The decoder requires every table below exactly once and rejects unknown, duplicate or missing tables.

- `identity`: `identity_actor`, `branch`, `staff_profile`, `staff_branch_grant`, `staff_operation`
- `catalog`: `catalog_category`, `catalog_size`, `catalog_color`, `catalog_product`, `catalog_product_variant`
- `inventory`: `inventory_settings`, `inventory_variant_setting`, `inventory_stock_clock`, `inventory_operation`, `inventory_batch`, `inventory_batch_balance` (schema 030 onward), `inventory_movement`, `inventory_allocation`, `inventory_discrepancy`, `inventory_known_till`, `inventory_count_coordination`, `inventory_count_coordination_device`, `inventory_stock_correction`, `inventory_stock_correction_batch`, `inventory_stock_reconciliation`, `inventory_stock_reconciliation_batch`, `inventory_protected_order`, `inventory_protected_order_allocation`, `inventory_order_disposition`, `inventory_order_disposition_allocation`, `inventory_delivered_return_allocation_effect`
- `receiving`: `receiving_receipt`, `receiving_receipt_line`, `receiving_correction`, `receiving_correction_line`
- `sales`: `sales_pos_snapshot`, `sales_pos_snapshot_price`, `sales_sale`, `sales_sale_line`, `sales_sale_unit`, and in the generation-aware profile `sales_restore_deferred_completion`
- `expenses`: `expense_category`, `expense_operation`, `expense_record`, `expense_change`
- `pricing`: `pricing_automatic_offer`, `pricing_automatic_offer_product`, `pricing_automatic_offer_category`, `pricing_automatic_offer_bundle_item`, `pricing_automatic_offer_buy_product`, `pricing_automatic_offer_buy_category`, `pricing_automatic_offer_reward_product`, `pricing_automatic_offer_reward_category`, `pricing_coupon`, `pricing_coupon_product`, `pricing_coupon_category`, `pricing_coupon_usage`
- `returns`: `returns_return`, `returns_return_line`, `returns_return_unit`, `returns_batch_restoration`, `returns_refund_event`, `returns_exchange_quote`, `returns_exchange`
- `corrections`: `recording_correction`, `recording_sale_line_value`, `recording_sale_unit_value`, `recording_return_line_value`, `recording_merchandise_fact`, `recording_online_return_unit_value`
- `online_orders`: `online_checkout_quote`, `online_order`, `online_order_line`, `online_order_agreement_quote`, `online_order_operation`, `online_order_contact_attempt`, `online_order_agreed_revision`, `online_order_confirmation`, `online_order_unreachable_cancellation`, `online_order_fulfillment_event`, `online_order_failed_return_inspection`, `online_order_failed_return_inspection_line`
- `storefront_configuration`: `storefront_contacts`, `delivery_area`, `online_order_settings`
- `opening_import`: accepted rows from `opening_import_preview` only
- `analytics`: `public_analytics_event`

The opening-import table stores the accepted parsed plan, state, response and operation fingerprints. It does not store the original CSV bytes. Because the accepted plan contains unit costs, it remains only inside the encrypted manager backup. `public_analytics_event` contains aggregate events and no visitor, session, IP address, user-agent or customer identity.

The archive never contains raw `user`, `account`, `session`, `verification`, `staff_session_branch` or `owner_recovery_challenge` rows. It also excludes service secrets, browser storage, unsent browser records and image binaries. The latest `schema_migrations` filename appears as `schemaVersion`; migration rows are not archived.

## Schema profiles

Version 1 recognizes these exact migration profiles. The decoder rejects unsupported schema names and inconsistent generation/table/reference-sequence profiles:

| `schemaVersion` | Profile facts |
| --- | --- |
| `028_aggregate_analytics.sql` | Legacy central stock; `sourceGeneration: null`; no retained-sale table or Sales generation columns. |
| `029_restore.sql` | Central stock; nonnegative integer `sourceGeneration`; retained-sale table and Sales generation columns as decimal text. |
| `030_branch_inventory.sql` | Adds `inventory_batch_balance` and branch attribution. Generation-aware. |
| `031_sale_payments.sql` | Adds sale payment method and online received amount alongside cash and exchange credit. |
| `032_catalog_online_variants.sql` | Adds online visibility of existing variant pairs. |
| `033_human_references.sql` | Adds persisted POS/return references and both reference sequence states in the manifest. |
| `034_order_recognition_branch.sql` | Adds online fulfillment/inspection branches and cancellation disposition, supporting confirmation-based recognition/reversal. |
| `035_return_reason.sql` | Current profile; adds nullable customer-return reason. |

Profiles 029–035 require a nonnegative source generation. Profiles 033–035 require `salesSaleReferenceSequence` and `returnsReturnReferenceSequence`; earlier profiles must omit those fields. Every profile includes `onlineOrderReferenceSequence`. Sequence state is `{ lastValue: decimal text, isCalled: boolean }`.

**Restore compatibility is narrower than decoding.** On this current 035 server, restore accepts 035 and the named 034→035 bridge only. The bridge validates old return rows and adds a null reason after authenticated decoding; it preserves the original archive manifest/checksums as source provenance. Other recognized profiles still fail the restore schema check before pausing business writes. No automatic central-stock-to-branch conversion is provided. See [staged restore](restore.md).

The profiles name exact migration files. A later migration must add its schema version to the decoder, or new backups and restore checkpoints stop decoding; the backup HTTP test catches this.

`inventory_known_till.restore_generation` is never archived in any profile: a known till's generation belongs to the destination database, which assigns it at activation. Retained completed sales in `sales_restore_deferred_completion` are business data and stay recoverable after a restore. They do not mean that sales still queued only in browser storage are included; `includesUnsentBrowserRecords` stays `false`.

## Value encoding

Readers run inside one `REPEATABLE READ READ ONLY` transaction with the session time zone set to UTC. PostgreSQL `date`, `time`, `timetz`, `timestamp`, `timestamptz` and `interval` values are archived as PostgreSQL text (for example `2026-09-16` and `2026-09-16 09:15:02.123456+00`), not as JavaScript instants. Business dates therefore never shift with the server time zone, and timestamps keep microsecond precision. `bigint` and `numeric` values are text; JSON columns are archived as JSON.

## Operating limits

The server estimates the canonical payload size while each feature reader returns its tables and stops at 128 MiB with an Arabic validation response. The estimate is checked after each feature's tables are loaded, so a single very large feature table is still read before the limit applies. One backup runs at a time per API process; a concurrent request receives `409 CONFLICT`. The lock is not shared between multiple API instances. If business data grows toward these limits, the archive format and limits need revisiting before the backup fails.

## Restore responsibilities

Version 1 verifies authentication, the table allowlist, per-section counts and checksums, the total count, the actor projection and the schema profile. It does not verify foreign-key relationships between archived rows. Restore checks target compatibility, loads the rows into an independent staging database with every constraint enabled and checks the remaining cross-table links before a preview can be confirmed; see [restore](restore.md).

Implementation references: [allowlist](../../../packages/backup/src/application/backup.ts), [decoder profiles](../../../packages/backup/src/adapters/encrypted-archive.ts), [snapshot metadata](../../../packages/backup/src/adapters/postgres-backup.ts), [branch-balance reader](../../../packages/inventory/src/adapters/postgres-backup.ts) and [restore sequence reconciliation](../../../packages/restore/src/adapters/postgres-restore.ts). For saving business data, copying media and owner recovery responsibilities, use [operator handover](../operator-handover.md).

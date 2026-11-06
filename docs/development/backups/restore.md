# Staged business-data restore

Ticket 27 / GitHub issue #28. A manager restores a version 1 business-data archive from **استعادة البيانات** in the staff app. Nothing replaces live data until the manager confirms a reviewed preview.

## Flow

1. **Decode and check compatibility.** The uploaded archive is decrypted and validated before anything else happens. A wrong password, a damaged file or an unsupported decoder profile returns an Arabic validation error. Successful decoding is not permission to activate an older schema. This artifact's latest migration is `038_pos_reference_counter.sql`, which uses the `037_operational_stock.sql` archive profile. Restore accepts that profile and named bridges from `034_order_recognition_branch.sql`, `035_return_reason.sql` and `036_receipt_numbering.sql`. The bridges add the applicable nullable return reason and receipt identity, an empty receipt registry and operational fields/seed rows; they validate historical shapes and preserve the original manifest. They do not convert central inventory or rewrite transaction history. Other schema mismatches fail before the business is paused. In particular, a decoded `028` or `029` central-stock archive cannot be activated on this branch-stock server. Do not edit archive metadata or assign central quantities to a branch to bypass this check. See [archive profiles](archive-v1.md#schema-profiles).
2. **Pause and stage.** Restore pauses business writes and creates an independent PostgreSQL database named `bravos_restore_stage_<id>`. It applies all migrations there and loads every archived table through the restore adapter owned by each feature, with foreign keys and checks enabled. Links that foreign keys cannot express are checked separately: receipt line and batch pairs, batch variants used by stock effects, coupon usage sources and sale-unit paid totals. If staging fails, the preview is cancelled, the staging database is dropped and writes resume.
3. **Checkpoint and reconcile.** While paused, restore creates a normal encrypted backup of the live data as the pre-restore checkpoint, using a separate password. It then merges that checkpoint into the staging database:
   - archive-only rows are added;
   - live-only rows (newer work) are kept;
   - rows whose stable key holds **different values** in the archive and in live data block the preview, because merging would silently discard one side.

   A database that only holds its first-run owner and default settings is treated as a disaster-recovery target: the archive is loaded as is. Device, snapshot and retained-sale rows always come from live data at activation.
4. **Review.** The preview shows per-section counts: archived, live, after activation, archive-only, newer-than-archive and conflicting. It also lists blocking reasons and every known till.
5. **Tills.** Every known till must issue a POS snapshot after the pause and confirm it. A till can only confirm when every pending completed sale in its queue is already held by the server, either applied or retained. Confirmation is tied to the till's own staff member and its latest snapshot.
6. **Checkpoint download.** The manager downloads the checkpoint, the browser verifies its SHA-256, and the manager confirms it is saved. The preview then becomes ready and gets a fingerprint.
7. **Activate.** The manager types the fingerprint. One transaction takes the exclusive restore lock and rechecks the preview, the checkpoint and every till. It then clears and reloads feature tables, including batch/branch balances, payment allocations, original transaction references and order recognition/reversal facts. It reconciles online-order, POS-sale, return and receipt-prefix high-water states with the archive, live state and restored records. It advances the restore generation to `max(current, archive source) + 1`. It also resets every known till to the new generation, deletes all sessions and verification rows, and records the activation. Any failure rolls back the activation and the preview stays paused. Repeating an activation with the same operation ID returns the recorded result.

## Write barrier

Migration 029 installs `restore_enter_business_write()` and a statement trigger on every business table. Feature transactions call the function first, so they hold a shared advisory lock until commit. Pausing and activation take the same lock exclusively. While paused, business writes fail with `409 RESTORE_PAUSED`, including public checkout and analytics. Sign-in, owner recovery, POS snapshots, till evidence and retained sales stay available. A business table added by a later migration needs its own guard trigger and a restore adapter; the migration test fails otherwise.

## Sales during and after a restore

A completed paid sale that reaches the server while restore is paused, or that was made under an older restore generation, is not applied to restored stock. It is kept in `sales_restore_deferred_completion` and listed on the restore page. A manager recovers each one once, which applies it and marks it reconciled in the same transaction. Sales retained during a pause that is later cancelled also wait for manager recovery. POS snapshots report the generation, the pause and proofs of retained sales. Offline queues store the generation of each sale.

## Accounts

Archives contain no credentials. Staff whose IDs survive keep their existing passwords; all sessions are revoked. After restoring into a fresh database, nobody has credentials: the owner uses the separate owner-recovery route and then resets staff passwords.

## Operating requirements and limits

- The API database role needs `CREATEDB` and must be able to connect to the `postgres` maintenance database to create and drop staging databases.
- Only one preview can be active. Creating and reconciling a preview reads archive/checkpoint rows into API memory. The staged rows live in the separate staging database, and the encrypted pre-restore checkpoint is persisted with the preview in the live database. The backup payload cap is 128 MiB and the complete encrypted archive cap is 192 MiB; these are size limits, not a total process-memory bound. Run restores at a quiet time.
- The checkpoint is stored with its preview and is for recovery into a fresh database. Restoring it into the same database merges with live data like any other archive, so it cannot undo an activation in place.
- A connected sale that was prepared after the archive, then completed only after a restore into a fresh database, cannot be recovered automatically: its accepted prices are not on the server. The manager re-enters it. The retained row has no dismiss action, so it stays listed as pending.
- Staging databases of cancelled or activated previews are dropped. If the API stops mid-restore, drop leftover `bravos_restore_stage_*` databases manually.

## Failed-release recovery

A failed release has no down-migration command. Two recoveries stay distinct:

1. **Externally verified PostgreSQL recovery.** Before a release changes an existing database, the operator already holds a verified external PostgreSQL backup, a separate encrypted business-data archive, and a separate media copy. Abandoning the release means a database administrator restores that verified backup with the host's own procedure, onto a target the owner names. This guide has no drop, restore, or overwrite command. Those steps need the actual host, the verified backup, and an explicit owner decision.
2. **Application merge restore.** **استعادة البيانات** loads a version 1 archive, pauses writes, stages another database, and merges the archive with the live checkpoint. Activation on a database that already has business data keeps live-only rows and blocks conflicting keys. It does not replace the live database with the archive. The pre-restore checkpoint cannot undo an activation in place: loading that checkpoint into the same database merges again. To leave an activated database, use the external PostgreSQL backup on a fresh target, or a reviewed fresh-database load. Do not run a second merge to reverse the first activation.

Leave every box unchecked until the owner executes it. Do not treat this list as a completed drill.

- [ ] The owner names the failed release and the decision: abandon it, or repair forward.
- [ ] Record the source and build that started, and the identity of the last known good backup.
- [ ] Confirm an externally verified PostgreSQL backup exists and was checked before this incident. If it does not, stop and preserve the current files. Do not invent a backup.
- [ ] Confirm the separate encrypted business archive and the separate media copy. Keep their passwords outside this record.
- [ ] Stop stock-changing work. Preserve unsynchronized till queues. Do not clear a browser queue to make the database look calm.
- [ ] Choose one path only after the owner decides:
  - External recovery of the verified PostgreSQL backup, using the host procedure once the owner supplies the host and the backup location.
  - Application merge restore only when the owner intends to merge a business archive with current live data, not to undo an activation.
  - Fresh-database load when the target has only the first-run owner and default settings. The archive is then loaded as it is.
- [ ] After a fresh target: the owner uses owner recovery, resets staff passwords, and recovers each retained or queued sale once.
- [ ] Restore missing product images from the separate media copy and confirm the referenced files open.
- [ ] Record the evidence, the named incident owner, and the time. Sign-off stays with the owner.

## Operator handoff

Use [the Arabic operator guide](../operator-handover.md) for staff responsibilities and [release rehearsal](../release-rehearsal.md) for process configuration, protected owner recovery and release commands. Save the encrypted archive and checkpoint outside the browser, with their passwords kept separately. Neither download contains image binaries, unsent browser queues, service secrets or staff credentials. Restore missing product images from a separate copy of `BRAVOS_PRODUCT_MEDIA_DIR`; image references alone do not recreate the files.

An incompatible older archive is an operator/developer recovery decision, not a supported one-click upgrade. Preserve the file and its password; ask the technical operator to identify a compatible server or an explicitly reviewed recovery plan. Migration `030_branch_inventory.sql` also refuses populated legacy central inventory rather than guessing a branch. Do not run migrations or restore drills against business data just to test compatibility.

Implementation references: [compatibility and activation adapter](../../../packages/restore/src/adapters/postgres-restore.ts), [nullable return-reason bridge](../../../packages/returns/src/adapters/postgres-restore.ts), [branch-stock migration](../../../packages/persistence/src/migrations/030_branch_inventory.sql) and [archive decoder](../../../packages/backup/src/adapters/encrypted-archive.ts). This guide describes those code paths; it does not record a completed operator restore drill.

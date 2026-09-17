# Staged business-data restore

Ticket 27 / GitHub issue #28. A manager restores a version 1 business-data archive from **استعادة البيانات** in the staff app. Nothing replaces live data until the manager confirms a reviewed preview.

## Flow

1. **Decode.** The uploaded archive is decrypted and validated with the ticket 26 decoder before anything else happens. A wrong password, a damaged file or an unsupported schema returns an Arabic validation error, and the business is not paused. Archives are accepted from this server's current schema; a legacy `028` archive is upgraded after authenticated decoding (see [archive v1](archive-v1.md)).
2. **Pause and stage.** Restore pauses business writes and creates an independent PostgreSQL database named `bravos_restore_stage_<id>`. It applies all migrations there and loads every archived table through the restore adapter owned by each feature, with foreign keys and checks enabled. Links that foreign keys cannot express are checked separately: receipt line and batch pairs, batch variants used by stock effects, coupon usage sources and sale-unit paid totals. If staging fails, the preview is cancelled, the staging database is dropped and writes resume.
3. **Checkpoint and reconcile.** While paused, restore creates a normal encrypted backup of the live data as the pre-restore checkpoint, using a separate password. It then merges that checkpoint into the staging database:
   - archive-only rows are added;
   - live-only rows (newer work) are kept;
   - rows whose stable key holds **different values** in the archive and in live data block the preview, because merging would silently discard one side.

   A database that only holds its first-run owner and default settings is treated as a disaster-recovery target: the archive is loaded as is. Device, snapshot and retained-sale rows always come from live data at activation.
4. **Review.** The preview shows per-section counts: archived, live, after activation, archive-only, newer-than-archive and conflicting. It also lists blocking reasons and every known till.
5. **Tills.** Every known till must issue a POS snapshot after the pause and confirm it. A till can only confirm when every pending completed sale in its queue is already held by the server, either applied or retained. Confirmation is tied to the till's own staff member and its latest snapshot.
6. **Checkpoint download.** The manager downloads the checkpoint, the browser verifies its SHA-256, and the manager confirms it is saved. The preview then becomes ready and gets a fingerprint.
7. **Activate.** The manager types the fingerprint. One transaction takes the exclusive restore lock and rechecks the preview, the checkpoint and every till. It then clears and reloads all feature tables, restores the online-order reference sequence and advances the restore generation to `max(current, archive source) + 1`. It also resets every known till to the new generation, deletes all sessions and verification rows, and records the activation. Any failure rolls back completely and the preview stays paused. Repeating an activation with the same operation ID returns the recorded result.

## Write barrier

Migration 029 installs `restore_enter_business_write()` and a statement trigger on every business table. Feature transactions call the function first, so they hold a shared advisory lock until commit. Pausing and activation take the same lock exclusively. While paused, business writes fail with `409 RESTORE_PAUSED`, including public checkout and analytics. Sign-in, owner recovery, POS snapshots, till evidence and retained sales stay available. A business table added by a later migration needs its own guard trigger and a restore adapter; the migration test fails otherwise.

## Sales during and after a restore

A completed paid sale that reaches the server while restore is paused, or that was made under an older restore generation, is not applied to restored stock. It is kept in `sales_restore_deferred_completion` and listed on the restore page. A manager recovers each one once, which applies it and marks it reconciled in the same transaction. Sales retained during a pause that is later cancelled also wait for manager recovery. POS snapshots report the generation, the pause and proofs of retained sales. Offline queues store the generation of each sale.

## Accounts

Archives contain no credentials. Staff whose IDs survive keep their existing passwords; all sessions are revoked. After restoring into a fresh database, nobody has credentials: the owner uses the separate owner-recovery route and then resets staff passwords.

## Operating requirements and limits

- The API database role needs `CREATEDB` and must be able to connect to the `postgres` maintenance database to create and drop staging databases.
- Only one preview can be active. A restore holds the uploaded archive, its decoded rows and the checkpoint in API memory. The ticket 26 payload cap (128 MiB) bounds this, but run restores at a quiet time.
- The checkpoint is stored with its preview and is for recovery into a fresh database. Restoring it into the same database merges with live data like any other archive, so it cannot undo an activation in place.
- A connected sale that was prepared after the archive, then completed only after a restore into a fresh database, cannot be recovered automatically: its accepted prices are not on the server. The manager re-enters it. The retained row has no dismiss action, so it stays listed as pending.
- Staging databases of cancelled or activated previews are dropped. If the API stops mid-restore, drop leftover `bravos_restore_stage_*` databases manually.

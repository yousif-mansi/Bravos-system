import { createHash } from "node:crypto";
import type {
  BackupData,
  BackupManifest,
  BackupSnapshotMetadata,
  BackupReaderSet,
  BackupUnitOfWork,
  DecodedBackupArchive,
} from "@bravos/backup";
import type {
  BackupTableSnapshot,
  RestoreDeviceDto,
  RestoreDifferenceDto,
  RestorePreviewDto,
  RestoreStateDto,
} from "@bravos/contracts";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { assertCrossFeatureLinks, type RestoreTables } from "../domain/archive-links.ts";
import { RestorePausedError, RestoreStaleError, RestoreValidationError } from "../domain/errors.ts";
import type {
  RestoreFeaturePort,
  RestoreFeatureSet,
  RestoreKnownTill,
  RestoreStore,
} from "../application/ports.ts";

// Restore control work takes this advisory lock exclusively; business writes take it shared.
const EXCLUSIVE_RESTORE_LOCK = "SELECT pg_advisory_xact_lock(1112687187, 27)";

// Load order follows foreign keys; clearing runs in reverse.
const TABLE_ORDER = [
  "identity_actor", "branch", "staff_profile", "staff_branch_grant", "staff_operation",
  "catalog_category", "catalog_size", "catalog_color", "catalog_product", "catalog_product_variant",
  "storefront_contacts", "delivery_area", "online_order_settings", "online_checkout_quote",
  "pricing_automatic_offer", "pricing_automatic_offer_product", "pricing_automatic_offer_category",
  "pricing_automatic_offer_bundle_item", "pricing_automatic_offer_buy_product", "pricing_automatic_offer_buy_category",
  "pricing_automatic_offer_reward_product", "pricing_automatic_offer_reward_category", "pricing_coupon",
  "pricing_coupon_product", "pricing_coupon_category",
  "sales_pos_snapshot", "sales_pos_snapshot_price", "sales_sale", "sales_sale_line", "sales_sale_unit",
  "sales_restore_deferred_completion",
  "inventory_settings", "inventory_variant_setting", "inventory_stock_clock", "inventory_operation", "inventory_batch",
  "inventory_batch_balance",
  "inventory_movement", "inventory_allocation", "inventory_discrepancy", "inventory_known_till",
  "inventory_count_coordination", "inventory_count_coordination_device", "inventory_stock_correction",
  "inventory_stock_correction_batch", "inventory_stock_reconciliation", "inventory_stock_reconciliation_batch",
  "receiving_receipt", "receiving_receipt_line", "receiving_correction", "receiving_correction_line",
  "online_order", "online_order_line", "online_order_agreement_quote", "online_order_operation",
  "online_order_contact_attempt", "online_order_agreed_revision", "online_order_confirmation",
  "online_order_unreachable_cancellation", "online_order_fulfillment_event", "online_order_failed_return_inspection",
  "online_order_failed_return_inspection_line",
  "inventory_protected_order", "inventory_protected_order_allocation", "inventory_order_disposition",
  "inventory_order_disposition_allocation", "inventory_delivered_return_allocation_effect",
  "pricing_coupon_usage", "expense_category", "expense_operation", "expense_record", "expense_change",
  "opening_import_preview", "returns_return", "returns_return_line",
  "recording_correction", "recording_sale_line_value", "recording_sale_unit_value", "recording_return_line_value",
  "recording_merchandise_fact", "recording_online_return_unit_value",
  "returns_return_unit", "returns_batch_restoration", "returns_refund_event", "returns_exchange_quote", "returns_exchange",
  "public_analytics_event",
] as const;

// Rows that describe devices and retained sales at the moment of activation. They always come
// from the live database so a till that acknowledged the pause is not replaced by older state.
const CONTROL_TABLE_KEYS: Record<string, string[]> = {
  sales_pos_snapshot: ["id"],
  sales_pos_snapshot_price: ["snapshot_id", "variant_id"],
  sales_restore_deferred_completion: ["operation_id"],
  inventory_known_till: ["device_id"],
};

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
};

type SequenceState = { lastValue: string; isCalled: boolean };
type ReferenceSequences = {
  onlineOrder: SequenceState;
  physicalSale: SequenceState;
  return: SequenceState;
};

export type RestoreStoreFactories = {
  features(queryable: Queryable): RestoreFeatureSet;
  // Feature backup readers bound to an open live transaction, using the archive value encoding.
  liveReaders(client: PoolClient): BackupReaderSet;
  // Reads a staging database through the same snapshot unit of work that produces archives.
  snapshot(pool: Pool): BackupUnitOfWork;
  migrate(pool: Pool): Promise<unknown>;
};

type PreviewRow = {
  id: string;
  operation_id: string;
  payload_fingerprint: string;
  status: RestorePreviewDto["status"];
  backup_id: string;
  archive_sha256: string;
  archive_schema_version: string;
  source_generation: string | null;
  expected_generation: string;
  staging_database_name: string;
  manifest_json: BackupManifest;
  differences_json: RestoreDifferenceDto[];
  blocking_reasons_json: string[];
  preview_fingerprint: string | null;
  pre_restore_archive_sha256: string | null;
  pre_restore_backup_id: string | null;
  pre_restore_download_acknowledged_at: Date | null;
  created_by_staff_id: string;
  created_at: Date;
  paused_at: Date | null;
  activated_at: Date | null;
};

type DeviceRow = {
  device_id: string;
  staff_id: string;
  known_snapshot_id: string;
  known_snapshot_at: Date;
  known_stock_version: string | null;
  known_restore_generation: string;
  pending_operation_ids: string[];
  custodied_operation_ids: string[];
  synchronization_complete: boolean;
  acknowledged_snapshot_id: string | null;
  acknowledged_at: Date | null;
};

const PREVIEW_COLUMNS = `id, operation_id, payload_fingerprint, status, backup_id, archive_sha256, archive_schema_version,
  source_generation::text, expected_generation::text, staging_database_name, manifest_json, differences_json,
  blocking_reasons_json, preview_fingerprint, pre_restore_archive_sha256, pre_restore_backup_id,
  pre_restore_download_acknowledged_at, created_by_staff_id, created_at, paused_at, activated_at`;

export function createPostgresRestoreStore(input: {
  pool: Pool;
  databaseUrl: string;
  factories: RestoreStoreFactories;
}): RestoreStore {
  const { pool, databaseUrl, factories } = input;

  async function control<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(EXCLUSIVE_RESTORE_LOCK);
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function dto(row: PreviewRow): Promise<RestorePreviewDto> {
    const live = row.status === "paused" || row.status === "ready" || row.status === "staged"
      ? await factories.features(pool).inventory.listKnownTillsForRestore()
      : [];
    return previewDto(pool, row, live);
  }

  async function mustGet(queryable: Queryable, id: string, lock = false) {
    const row = await getPreview(queryable, id, lock);
    if (!row) throw new RestoreValidationError("معاينة الاستعادة غير موجودة.");
    return row;
  }

  return {
    async state() {
      const result = await pool.query<{ current_generation: string; paused_preview_id: string | null; paused_at: Date | null }>(
        "SELECT current_generation::text, paused_preview_id, paused_at FROM restore_runtime WHERE singleton = TRUE",
      );
      return stateDto(result.rows[0]!);
    },

    async list() {
      const rows = await pool.query<PreviewRow>(`SELECT ${PREVIEW_COLUMNS} FROM restore_preview ORDER BY created_at DESC, id DESC`);
      return Promise.all(rows.rows.map(dto));
    },

    async get(id) {
      const row = await getPreview(pool, id);
      return row ? dto(row) : null;
    },

    async stageAndPause(stageInput) {
      const replay = await getPreviewByOperation(pool, stageInput.operationId);
      if (replay) return { value: await dto(assertReplay(replay, stageInput.payloadFingerprint)), created: false };
      const upgradeReasonless = await assertSupportedSchema(pool, stageInput.archive.manifest.schemaVersion);
      // Uploaded bytes and section hashes were authenticated before this boundary.
      // Retain their manifest/checksum as source provenance; stage the exact target
      // rows and let the existing preview fingerprint protect their reconciliation.
      const archive = upgradeReasonless ? {
        manifest: stageInput.archive.manifest,
        data: { ...stageInput.archive.data, returns: { ...stageInput.archive.data.returns,
          returns_return: await factories.features(pool).returns.upgradeReasonlessRestoreRows(
            stageInput.archive.data.returns.returns_return ?? [],
          ).catch((error: unknown) => { throw asDataError(error, "سجل المرتجع لا يطابق إصدار النسخة القديم."); }),
        } },
      } : stageInput.archive;
      const archiveTables = flattenData(archive.data);
      assertArchiveTables(archiveTables, factories.features(pool));
      assertCrossFeatureLinks(archiveTables);

      const stageName = `bravos_restore_stage_${stageInput.id.replaceAll("-", "")}`;
      const paused = await control(async (client) => {
        const insideReplay = await getPreviewByOperation(client, stageInput.operationId);
        if (insideReplay) return insideReplay;
        const runtime = await client.query<{ current_generation: string; paused_preview_id: string | null }>(
          "SELECT current_generation::text, paused_preview_id FROM restore_runtime WHERE singleton = TRUE FOR UPDATE",
        );
        if (runtime.rows[0]!.paused_preview_id) throw new RestorePausedError("توجد معاينة استعادة أخرى قيد المراجعة. ألغها أولاً.");
        await client.query(
          `INSERT INTO restore_preview (
             id, operation_id, payload_fingerprint, status, backup_id, archive_sha256, archive_schema_version,
             source_generation, expected_generation, staging_database_name, manifest_json, created_by_staff_id,
             created_at, paused_at
           ) VALUES ($1, $2, $3, 'staged', $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $12)`,
          [
            stageInput.id, stageInput.operationId, stageInput.payloadFingerprint, stageInput.archive.manifest.backupId,
            stageInput.archiveSha256, stageInput.archive.manifest.schemaVersion, stageInput.archive.manifest.sourceGeneration,
            runtime.rows[0]!.current_generation, stageName, JSON.stringify(stageInput.archive.manifest),
            stageInput.actorStaffId, stageInput.at,
          ],
        );
        await client.query(
          "UPDATE restore_runtime SET paused_preview_id = $1, paused_at = $2, paused_by_staff_id = $3 WHERE singleton = TRUE",
          [stageInput.id, stageInput.at, stageInput.actorStaffId],
        );
        return null;
      });
      if (paused) return { value: await dto(assertReplay(paused, stageInput.payloadFingerprint)), created: false };

      try {
        // Writers that saw the database before the pause committed finish before the checkpoint is taken.
        await control(async () => undefined);
        await createStage(databaseUrl, stageName, archive, factories);
        await pool.query("UPDATE restore_preview SET status = 'paused' WHERE id = $1 AND status = 'staged'", [stageInput.id]);
        return { value: await dto(await mustGet(pool, stageInput.id)), created: true };
      } catch (error) {
        const cleanupFailures = await failuresOf([
          cancelPreview(control, stageInput.id, stageInput.actorStaffId),
          dropStage(databaseUrl, stageName),
        ]);
        if (cleanupFailures.length > 0) {
          throw new AggregateError([error, ...cleanupFailures], "Restore staging failed and its cleanup did not complete.");
        }
        throw asDataError(error, "تعذر تحميل النسخة في قاعدة الاستعادة المعزولة. تحقق من سلامة روابط البيانات.");
      }
    },

    async attachPreRestoreBackup(attachInput) {
      const staged = await mustGet(pool, attachInput.previewId);
      if (staged.status !== "paused" && staged.status !== "ready") throw new RestoreStaleError();
      let reconciliation: Reconciliation;
      try {
        reconciliation = await reconcileStage(databaseUrl, staged.staging_database_name, attachInput.liveArchive, factories);
      } catch (error) {
        if (!isDataError(error)) throw error;
        reconciliation = {
          differences: differencesFor(staged.manifest_json, attachInput.backup.manifest),
          blockers: ["تعذر دمج النشاط الأحدث مع النسخة بأمان لأن الروابط أو القيم المدموجة غير متسقة. ألغِ المعاينة وراجع العمليات الأحدث."],
        };
      }
      const blockers = reconciliation.blockers;
      await control(async (client) => {
        const row = await mustGet(client, attachInput.previewId, true);
        if (row.status !== "paused" && row.status !== "ready") throw new RestoreStaleError();
        if (row.pre_restore_archive_sha256 && row.pre_restore_archive_sha256 !== attachInput.backup.archiveSha256) {
          throw new RestoreStaleError();
        }
        await client.query(
          `UPDATE restore_preview SET pre_restore_archive = $2, pre_restore_archive_sha256 = $3, pre_restore_backup_id = $4,
             differences_json = $5::jsonb, blocking_reasons_json = $6::jsonb
           WHERE id = $1`,
          [
            row.id, Buffer.from(attachInput.backup.bytes), attachInput.backup.archiveSha256,
            attachInput.backup.manifest.backupId,
            JSON.stringify(reconciliation.differences), JSON.stringify(blockers),
          ],
        );
        await refreshReadiness(client, row.id, factories.features(client));
      });
      return dto(await mustGet(pool, attachInput.previewId));
    },

    async acknowledge(ackInput) {
      await control(async (client) => {
        const preview = await getPreview(client, ackInput.previewId, true);
        if (!preview || (preview.status !== "paused" && preview.status !== "ready")) throw new RestoreStaleError();
        const runtime = await client.query<{ current_generation: string; paused_preview_id: string | null }>(
          "SELECT current_generation::text, paused_preview_id FROM restore_runtime WHERE singleton = TRUE",
        );
        if (runtime.rows[0]!.paused_preview_id !== preview.id
          || runtime.rows[0]!.current_generation !== preview.expected_generation) {
          throw new RestoreStaleError();
        }
        const features = factories.features(client);
        const till = (await features.inventory.listKnownTillsForRestore()).find((row) => row.deviceId === ackInput.deviceId);
        if (!till || till.staffId !== ackInput.actorStaffId || till.latestSnapshotId !== ackInput.snapshotId
          || till.latestSnapshotAt < (preview.paused_at ?? preview.created_at)
          || till.restoreGeneration !== Number(preview.expected_generation)) {
          throw new RestoreStaleError("يجب مزامنة هذا الجهاز وإصدار لقطة جديدة تعرض توقف الاستعادة قبل التأكيد.");
        }
        const custodied = await custodiedOperations(features, till);
        if (!custodied) throw new RestoreStaleError("توجد مبيعات مكتملة على هذا الجهاز لم تصل بعد إلى الحفظ لدى الخادم.");
        await client.query(
          `INSERT INTO restore_preview_till (
             preview_id, device_id, staff_id, known_snapshot_id, known_snapshot_at, known_stock_version,
             known_restore_generation, pending_operation_ids, custodied_operation_ids, synchronization_complete,
             acknowledged_snapshot_id, acknowledged_at, acknowledged_stock_version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid[], $9::uuid[], $10, $4, now(), $6)
           ON CONFLICT (preview_id, device_id) DO UPDATE SET
             staff_id = EXCLUDED.staff_id, known_snapshot_id = EXCLUDED.known_snapshot_id,
             known_snapshot_at = EXCLUDED.known_snapshot_at, known_stock_version = EXCLUDED.known_stock_version,
             known_restore_generation = EXCLUDED.known_restore_generation,
             pending_operation_ids = EXCLUDED.pending_operation_ids,
             custodied_operation_ids = EXCLUDED.custodied_operation_ids,
             synchronization_complete = EXCLUDED.synchronization_complete,
             acknowledged_snapshot_id = EXCLUDED.acknowledged_snapshot_id,
             acknowledged_at = EXCLUDED.acknowledged_at,
             acknowledged_stock_version = EXCLUDED.acknowledged_stock_version`,
          [
            preview.id, till.deviceId, till.staffId, till.latestSnapshotId, till.latestSnapshotAt, till.stockVersion,
            till.restoreGeneration, [...new Set(till.pendingOperationIds)].sort(), custodied, till.synchronizationComplete,
          ],
        );
        await refreshReadiness(client, preview.id, features);
      });
      return dto(await mustGet(pool, ackInput.previewId));
    },

    async cancel(cancelInput) {
      await cancelPreview(control, cancelInput.previewId, cancelInput.actorStaffId);
      const row = await mustGet(pool, cancelInput.previewId);
      await dropStage(databaseUrl, row.staging_database_name).catch(() => undefined);
      return dto(row);
    },

    async readPreRestoreBackup(previewId) {
      const result = await pool.query<{ pre_restore_archive: Buffer | null; pre_restore_archive_sha256: string | null; created_at: Date }>(
        "SELECT pre_restore_archive, pre_restore_archive_sha256, created_at FROM restore_preview WHERE id = $1",
        [previewId],
      );
      const row = result.rows[0];
      if (!row) throw new RestoreValidationError("معاينة الاستعادة غير موجودة.");
      if (!row.pre_restore_archive || !row.pre_restore_archive_sha256) throw new RestoreStaleError("لم تُنشأ نسخة البيانات الحالية بعد.");
      return {
        bytes: new Uint8Array(row.pre_restore_archive.buffer, row.pre_restore_archive.byteOffset, row.pre_restore_archive.byteLength),
        archiveSha256: row.pre_restore_archive_sha256,
        fileName: `bravos-pre-restore-${row.created_at.toISOString().replaceAll(":", "-").replaceAll(".", "-")}.bravos-backup`,
      };
    },

    async acknowledgePreRestoreBackup(ackInput) {
      await control(async (client) => {
        const row = await getPreview(client, ackInput.previewId, true);
        if (!row || (row.status !== "paused" && row.status !== "ready")
          || row.pre_restore_archive_sha256 !== ackInput.archiveSha256) {
          throw new RestoreStaleError("بصمة ملف نسخة البيانات الحالية لا تطابق الملف المحفوظ.");
        }
        await client.query(
          `UPDATE restore_preview SET
             pre_restore_download_acknowledged_by_staff_id = COALESCE(pre_restore_download_acknowledged_by_staff_id, $2),
             pre_restore_download_acknowledged_at = COALESCE(pre_restore_download_acknowledged_at, now())
           WHERE id = $1`,
          [row.id, ackInput.actorStaffId],
        );
        await refreshReadiness(client, row.id, factories.features(client));
      });
      return dto(await mustGet(pool, ackInput.previewId));
    },

    async activate(activationInput) {
      const replay = await activationByOperation(pool, activationInput.operationId);
      if (replay) return activationReplay(replay, activationInput.payloadFingerprint, pool, dto);
      const before = await mustGet(pool, activationInput.previewId);
      if (before.status !== "ready" || before.preview_fingerprint !== activationInput.previewFingerprint) {
        throw new RestoreStaleError();
      }
      const stagePool = new Pool({ connectionString: databaseUrlFor(databaseUrl, before.staging_database_name), max: 1 });
      let staged: { tables: RestoreTables; sequences: ReferenceSequences };
      try {
        staged = await factories.snapshot(stagePool).run(async (transaction) => ({
          tables: tablesByName(await readAllTables(transaction.readers)),
          sequences: metadataSequences(await transaction.metadata()),
        }));
      } finally {
        await stagePool.end();
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL TIME ZONE 'UTC'");
        await client.query(EXCLUSIVE_RESTORE_LOCK);
        const insideReplay = await activationByOperation(client, activationInput.operationId);
        if (insideReplay) {
          await client.query("COMMIT");
          return activationReplay(insideReplay, activationInput.payloadFingerprint, pool, dto);
        }
        const runtime = await client.query<{ current_generation: string; paused_preview_id: string | null }>(
          "SELECT current_generation::text, paused_preview_id FROM restore_runtime WHERE singleton = TRUE FOR UPDATE",
        );
        const preview = await getPreview(client, activationInput.previewId, true);
        if (!preview || preview.status !== "ready" || runtime.rows[0]!.paused_preview_id !== preview.id
          || runtime.rows[0]!.current_generation !== preview.expected_generation
          || preview.preview_fingerprint !== activationInput.previewFingerprint
          || !preview.pre_restore_backup_id || !preview.pre_restore_archive_sha256
          || !preview.pre_restore_download_acknowledged_at || preview.blocking_reasons_json.length > 0) {
          throw new RestoreStaleError();
        }
        const features = factories.features(client);
        await assertTillsReady(client, preview, features);

        await client.query("SELECT set_config('bravos.restore_activation', $1, true)", [preview.id]);
        const liveReaders = factories.liveReaders(client);
        const liveSequences: ReferenceSequences = {
          onlineOrder: await liveReaders.onlineOrders.readReferenceSequence(),
          physicalSale: await liveReaders.sales.readReferenceSequence(),
          return: await liveReaders.returns.readReferenceSequence(),
        };
        const liveControl = tablesByName([
          ...await liveReaders.sales.readBackupTables(),
          ...await liveReaders.inventory.readBackupTables(),
        ]);
        const data = mergeControlRows(staged.tables, liveControl);
        assertCrossFeatureLinks(data);
        await clearAll(features);
        await insertAll(features, data);
        // Sequence changes are not rolled back by PostgreSQL, so activation also considers
        // the live positions at the final checkpoint before changing them.
        await restoreReferenceSequences(features, laterSequences(staged.sequences, liveSequences));

        const previousGeneration = Number(runtime.rows[0]!.current_generation);
        const sourceGeneration = preview.source_generation === null ? 0 : Number(preview.source_generation);
        const activatedGeneration = Math.max(previousGeneration, sourceGeneration) + 1;
        if (!Number.isSafeInteger(activatedGeneration)) throw new RestoreValidationError("تعذر إنشاء جيل بيانات تالٍ آمن.");
        await features.inventory.assignRestoreGeneration(activatedGeneration);
        await client.query(
          `INSERT INTO restore_activation (
             id, operation_id, payload_fingerprint, preview_id, previous_generation, activated_generation,
             pre_restore_backup_id, pre_restore_archive_sha256, activated_by_staff_id, activated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            activationInput.id, activationInput.operationId, activationInput.payloadFingerprint, preview.id,
            previousGeneration, activatedGeneration, preview.pre_restore_backup_id, preview.pre_restore_archive_sha256,
            activationInput.actorStaffId, activationInput.at,
          ],
        );
        await client.query("UPDATE restore_preview SET status = 'activated', activated_at = $2 WHERE id = $1", [preview.id, activationInput.at]);
        await client.query(
          `UPDATE restore_runtime SET current_generation = $1, paused_preview_id = NULL, paused_at = NULL, paused_by_staff_id = NULL
           WHERE singleton = TRUE`,
          [activatedGeneration],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (error instanceof RestoreStaleError) throw error;
        throw asDataError(error, "تعذر تفعيل الاستعادة لأن البيانات المجهزة غير متسقة، ولم تتغير البيانات الحالية.");
      } finally {
        client.release();
      }
      await dropStage(databaseUrl, before.staging_database_name).catch(() => undefined);
      return { value: await dto(await mustGet(pool, activationInput.previewId)), created: true };
    },
  };
}

async function createStage(databaseUrl: string, name: string, archive: DecodedBackupArchive, factories: RestoreStoreFactories) {
  await adminQuery(databaseUrl, `CREATE DATABASE ${quotedDatabase(name)}`);
  const stage = new Pool({ connectionString: databaseUrlFor(databaseUrl, name), max: 1 });
  try {
    await factories.migrate(stage);
    await loadStage(stage, flattenData(archive.data), manifestSequences(archive.manifest), factories);
  } finally {
    await stage.end();
  }
}

type Reconciliation = { differences: RestoreDifferenceDto[]; blockers: string[] };

// The paused live checkpoint is merged into the staged archive. Archive-only rows are restored and
// live-only rows are kept, so newer work is never dropped. When the same stable key holds different
// values on both sides the merge would have to silently discard one of them, so the preview is blocked.
// A first-run database that only holds the bootstrap owner is a disaster-recovery target instead.
async function reconcileStage(
  databaseUrl: string,
  name: string,
  liveArchive: DecodedBackupArchive,
  factories: RestoreStoreFactories,
): Promise<Reconciliation> {
  const stage = new Pool({ connectionString: databaseUrlFor(databaseUrl, name), max: 1 });
  try {
    const staged = await factories.snapshot(stage).run(async (transaction) => ({
      tables: tablesByName(await readAllTables(transaction.readers)),
      sequences: metadataSequences(await transaction.metadata()),
    }));
    const live = flattenData(liveArchive.data);
    const keys = await primaryKeyColumns(stage);
    const liveIsBootstrap = isPristineBootstrap(live);
    const merged: RestoreTables = new Map();
    const counts = new Map<string, { archived: number; live: number; restored: number; archiveOnly: number; liveOnly: number; conflicting: number }>();
    for (const tableName of TABLE_ORDER) {
      const primaryKey = keys.get(tableName);
      if (!primaryKey?.length) throw new Error(`Restore table has no primary key metadata: ${tableName}`);
      const archivedRows = staged.tables.get(tableName) ?? [];
      const liveRows = liveIsBootstrap ? [] : live.get(tableName) ?? [];
      const rows = new Map<string, Record<string, unknown>>();
      for (const row of archivedRows) rows.set(rowKey(row, primaryKey), row);
      let liveOnly = 0;
      let conflicting = 0;
      for (const row of liveRows) {
        const key = rowKey(row, primaryKey);
        const archived = rows.get(key);
        if (!archived) liveOnly += 1;
        else if (canonicalRow(archived) !== canonicalRow(row) && !(tableName in CONTROL_TABLE_KEYS) && tableName !== "inventory_stock_clock") {
          conflicting += 1;
        }
        rows.set(key, tableName === "inventory_stock_clock" ? laterStockClock(archived, row) : row);
      }
      merged.set(tableName, [...rows.values()]);
      counts.set(tableName, {
        archived: archivedRows.length,
        live: (live.get(tableName) ?? []).length,
        restored: rows.size,
        archiveOnly: rows.size - liveRows.length,
        liveOnly,
        conflicting,
      });
    }

    const differences = liveArchive.manifest.sections.map((section) => {
      const totals = { archived: 0, live: 0, restored: 0, archiveOnly: 0, liveOnly: 0, conflicting: 0 };
      for (const table of section.tables) {
        const tableCounts = counts.get(table.name);
        if (!tableCounts) continue;
        for (const field of Object.keys(totals) as Array<keyof typeof totals>) totals[field] += tableCounts[field];
      }
      return {
        section: section.name,
        archivedRecordCount: totals.archived,
        liveRecordCount: totals.live,
        restoredRecordCount: totals.restored,
        archiveOnlyRecordCount: totals.archiveOnly,
        liveOnlyRecordCount: totals.liveOnly,
        conflictingRecordCount: totals.conflicting,
        difference: totals.live - totals.archived,
      };
    });

    const blockers: string[] = [];
    const conflictingSections = differences.filter((difference) => difference.conflictingRecordCount > 0);
    if (conflictingSections.length > 0) {
      blockers.push(`تحتوي النسخة والبيانات الحالية على قيم مختلفة لنفس السجلات في: ${conflictingSections.map((difference) => difference.section).join("، ")}. `
        + "لا يمكن الدمج دون استبدال نشاط أحدث بصمت. استعد النسخة في قاعدة بيانات جديدة أو ألغِ المعاينة.");
    }
    const archivedLogins = new Map((staged.tables.get("identity_actor") ?? []).map((actor) => [actor.username, actor.id]));
    const collidingLogin = (liveIsBootstrap ? [] : live.get("identity_actor") ?? [])
      .some((actor) => archivedLogins.has(actor.username) && archivedLogins.get(actor.username) !== actor.id);
    if (collidingLogin) {
      blockers.push("يوجد في البيانات الحالية حساب موظف يستخدم اسم دخول حساب آخر داخل النسخة. استعد النسخة في قاعدة بيانات جديدة أو ألغِ المعاينة.");
    }
    if (blockers.length > 0) return { differences, blockers };

    assertCrossFeatureLinks(merged);
    const sequences = liveIsBootstrap ? staged.sequences : laterSequences(staged.sequences, manifestSequences(liveArchive.manifest));
    await loadStage(stage, merged, sequences, factories);
    return { differences, blockers };
  } finally {
    await stage.end();
  }
}

async function loadStage(stage: Pool, data: RestoreTables, sequences: ReferenceSequences, factories: RestoreStoreFactories) {
  const client = await stage.connect();
  try {
    await client.query("BEGIN");
    const features = factories.features(client);
    await clearAll(features);
    await insertAll(features, data);
    await restoreReferenceSequences(features, sequences);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function assertTillsReady(client: PoolClient, preview: PreviewRow, features: RestoreFeatureSet) {
  const acknowledged = new Map((await deviceRows(client, preview.id)).map((row) => [row.device_id, row]));
  for (const till of await features.inventory.listKnownTillsForRestore()) {
    const row = acknowledged.get(till.deviceId);
    if (!row?.acknowledged_snapshot_id || till.restoreGeneration !== Number(preview.expected_generation)
      || till.latestSnapshotAt < (preview.paused_at ?? preview.created_at)) {
      throw new RestoreStaleError("يوجد جهاز بيع لم يؤكد توقف الاستعادة بعد.");
    }
    if (!await custodiedOperations(features, till)) {
      throw new RestoreStaleError("توجد مبيعات مكتملة على جهاز بيع لم تصل بعد إلى الحفظ لدى الخادم.");
    }
  }
}

// Returns the custodied pending operations, or null when a pending completed sale is not yet held by the server.
async function custodiedOperations(features: RestoreFeatureSet, till: RestoreKnownTill): Promise<string[] | null> {
  const pending = [...new Set(till.pendingOperationIds)].sort();
  const proofs = new Set((await features.sales.listRestoreCustodyProofs(pending)).map((proof) => proof.operationId));
  return pending.every((operationId) => proofs.has(operationId)) ? pending : null;
}

async function refreshReadiness(client: PoolClient, previewId: string, features: RestoreFeatureSet) {
  const row = await getPreview(client, previewId, true);
  if (!row) return;
  const devices = await deviceRows(client, previewId);
  const acknowledged = new Set(devices.filter((device) => device.acknowledged_snapshot_id).map((device) => device.device_id));
  const tills = await features.inventory.listKnownTillsForRestore();
  const complete = Boolean(row.pre_restore_backup_id && row.pre_restore_download_acknowledged_at)
    && row.blocking_reasons_json.length === 0
    && tills.every((till) => acknowledged.has(till.deviceId));
  if (!complete) {
    await client.query("UPDATE restore_preview SET status = 'paused', preview_fingerprint = NULL WHERE id = $1", [previewId]);
    return;
  }
  const targetSchema = (await client.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1")).rows[0]?.id;
  const fingerprint = sha256(JSON.stringify({
    sourceSchema: row.archive_schema_version,
    targetSchema,
    archiveSha256: row.archive_sha256,
    preRestoreArchiveSha256: row.pre_restore_archive_sha256,
    expectedGeneration: Number(row.expected_generation),
    differences: row.differences_json,
    devices: devices.filter((device) => device.acknowledged_snapshot_id).map((device) => ({
      deviceId: device.device_id,
      acknowledgedSnapshotId: device.acknowledged_snapshot_id,
      pendingOperationIds: [...device.pending_operation_ids].sort(),
      custodiedOperationIds: [...device.custodied_operation_ids].sort(),
    })),
  }));
  await client.query("UPDATE restore_preview SET status = 'ready', preview_fingerprint = $2 WHERE id = $1", [previewId, fingerprint]);
}

async function cancelPreview(
  control: <T>(work: (client: PoolClient) => Promise<T>) => Promise<T>,
  previewId: string,
  actorStaffId: string,
) {
  await control(async (client) => {
    const row = await getPreview(client, previewId, true);
    if (!row) throw new RestoreValidationError("معاينة الاستعادة غير موجودة.");
    if (row.status === "activated") throw new RestoreStaleError("تم تفعيل هذه الاستعادة بالفعل.");
    if (row.status === "cancelled") return;
    await client.query(
      `UPDATE restore_preview SET status = 'cancelled', cancelled_at = now(), cancelled_by_staff_id = $2, preview_fingerprint = NULL
       WHERE id = $1`,
      [previewId, actorStaffId],
    );
    await client.query(
      `UPDATE restore_runtime SET paused_preview_id = NULL, paused_at = NULL, paused_by_staff_id = NULL
       WHERE singleton = TRUE AND paused_preview_id = $1`,
      [previewId],
    );
  });
}

function assertArchiveTables(data: RestoreTables, features: RestoreFeatureSet) {
  const owned = new Set(featureList(features).flatMap((feature) => [...feature.tableNames]));
  const ordered = new Set<string>(TABLE_ORDER);
  const received = [...data.keys()];
  const mismatched = [
    ...[...ordered].filter((name) => !owned.has(name) || !data.has(name)),
    ...received.filter((name) => !ordered.has(name) || !owned.has(name)),
  ];
  if (mismatched.length > 0 || owned.size !== ordered.size) {
    throw new RestoreValidationError("جداول النسخة لا تطابق مخطط الاستعادة في هذا الإصدار.");
  }
}

function featureList(features: RestoreFeatureSet): RestoreFeaturePort[] {
  return [features.identity, features.catalog, features.sales, features.inventory, features.receiving, features.pricing,
    features.expenses, features.onlineOrders, features.storefrontConfiguration, features.returns, features.corrections,
    features.openingImport, features.analytics];
}

function owners(features: RestoreFeatureSet) {
  const result = new Map<string, RestoreFeaturePort>();
  for (const feature of featureList(features)) {
    for (const name of feature.tableNames) {
      if (result.has(name)) throw new Error(`Restore table has more than one owner: ${name}`);
      result.set(name, feature);
    }
  }
  return result;
}

async function clearAll(features: RestoreFeatureSet) {
  const byTable = owners(features);
  for (const name of [...TABLE_ORDER].reverse()) {
    const owner = byTable.get(name);
    if (!owner) throw new Error(`No restore owner for ${name}`);
    await owner.clearRestoreTable(name);
  }
}

async function insertAll(features: RestoreFeatureSet, data: RestoreTables) {
  const byTable = owners(features);
  for (const name of TABLE_ORDER) {
    const owner = byTable.get(name);
    const rows = data.get(name);
    if (!owner || !rows) throw new Error(`Missing restore data or owner for ${name}`);
    const inserted = await owner.insertRestoreTable(name, rows);
    if (inserted !== rows.length) throw new Error(`Restore row count mismatch for ${name}`);
  }
}

async function readAllTables(readers: BackupReaderSet): Promise<BackupTableSnapshot[]> {
  const result: BackupTableSnapshot[] = [];
  for (const reader of [readers.identity, readers.catalog, readers.inventory, readers.receiving, readers.sales,
    readers.expenses, readers.pricing, readers.returns, readers.corrections, readers.onlineOrders,
    readers.storefrontConfiguration, readers.openingImport, readers.analytics]) {
    result.push(...await reader.readBackupTables());
  }
  return result;
}

function mergeControlRows(staged: RestoreTables, live: RestoreTables): RestoreTables {
  const result: RestoreTables = new Map(staged);
  for (const [tableName, primaryKey] of Object.entries(CONTROL_TABLE_KEYS)) {
    const rows = new Map<string, Record<string, unknown>>();
    for (const row of staged.get(tableName) ?? []) rows.set(rowKey(row, primaryKey), row);
    for (const row of live.get(tableName) ?? []) rows.set(rowKey(row, primaryKey), row);
    result.set(tableName, [...rows.values()]);
  }
  return result;
}

async function primaryKeyColumns(queryable: Queryable) {
  const rows = await queryable.query<{ table_name: string; column_name: string }>(
    `SELECT tc.table_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
     WHERE tc.table_schema = current_schema() AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY tc.table_name, kcu.ordinal_position`,
  );
  const result = new Map<string, string[]>();
  for (const row of rows.rows) {
    const name = row.table_name === "user" ? "identity_actor" : row.table_name;
    result.set(name, [...(result.get(name) ?? []), row.column_name]);
  }
  return result;
}

function rowKey(row: Record<string, unknown>, keys: string[]) {
  return JSON.stringify(keys.map((key) => {
    if (!(key in row)) throw new RestoreValidationError("تحتوي النسخة على سجل بلا مفتاح ثابت.");
    return row[key];
  }));
}

// A database that only holds the first-run owner and default settings is a disaster-recovery target.
function isPristineBootstrap(tables: RestoreTables): boolean {
  const seedTables = new Set(["identity_actor", "branch", "staff_profile", "staff_branch_grant", "staff_operation", "inventory_settings",
    "inventory_stock_clock", "online_order_settings"]);
  for (const [tableName, rows] of tables) {
    if (!seedTables.has(tableName) && rows.length > 0) return false;
  }
  const actors = tables.get("identity_actor") ?? [];
  const profiles = tables.get("staff_profile") ?? [];
  const operations = tables.get("staff_operation") ?? [];
  const clock = tables.get("inventory_stock_clock") ?? [];
  const settings = tables.get("online_order_settings") ?? [];
  return actors.length === 1 && actors[0]?.role === "manager"
    && profiles.length === 1 && profiles[0]?.is_owner === true && profiles[0]?.staff_id === actors[0]?.id
    && operations.length <= 1 && operations.every((operation) => operation.staff_id === actors[0]?.id)
    && (tables.get("staff_branch_grant") ?? []).every((grant) => grant.staff_id === actors[0]?.id)
    && (tables.get("branch") ?? []).length === 2
    && clock.length === 1 && String(clock[0]?.version) === "0"
    && settings.length === 1 && settings[0]?.changed_by_staff_id === null;
}

function laterStockClock(archived: Record<string, unknown> | undefined, live: Record<string, unknown>) {
  if (!archived) return live;
  return BigInt(String(archived.version)) > BigInt(String(live.version)) ? archived : live;
}

function canonicalRow(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalRow).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalRow(record[key])}`).join(",")}}`;
}

// Archive or staged data that cannot be loaded is reported to the manager; anything else is a server fault.
function isDataError(error: unknown): boolean {
  if (error instanceof RestoreValidationError) return true;
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === "RESTORE_DATA_INVALID" || (typeof code === "string" && /^(22|23)[0-9A-Z]{3}$/.test(code));
}

function asDataError(error: unknown, message: string): unknown {
  if (error instanceof RestoreValidationError || !isDataError(error)) return error;
  return new RestoreValidationError(message, { cause: error });
}

async function failuresOf(work: Array<Promise<unknown>>): Promise<unknown[]> {
  const results = await Promise.allSettled(work);
  return results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
}

// Keep exact schema compatibility except the named 034 -> 035 nullable-reason
// bridge. Central stock, references, payment and generation semantics are unchanged
// in that one profile; all other mismatches still fail.
async function assertSupportedSchema(queryable: Queryable, schemaVersion: string) {
  const result = await queryable.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1");
  const latest = result.rows[0]?.id;
  if (schemaVersion === latest) return false;
  if (latest === "035_return_reason.sql" && schemaVersion === "034_order_recognition_branch.sql") return true;
  throw new RestoreValidationError("إصدار مخطط النسخة لا يطابق إصدار هذا الخادم. استخدم نسخة من الإصدار نفسه أو حدّث الخادم أولاً.");
}

function metadataSequences(metadata: BackupSnapshotMetadata): ReferenceSequences {
  return {
    onlineOrder: metadata.onlineOrderReferenceSequence,
    physicalSale: metadata.salesSaleReferenceSequence,
    return: metadata.returnsReturnReferenceSequence,
  };
}

function manifestSequences(manifest: BackupManifest): ReferenceSequences {
  if (!manifest.salesSaleReferenceSequence || !manifest.returnsReturnReferenceSequence) {
    throw new RestoreValidationError("إصدار النسخة لا يحتوي على مراجع البيع والمرتجعات المطلوبة لهذا الخادم.");
  }
  return {
    onlineOrder: manifest.onlineOrderReferenceSequence,
    physicalSale: manifest.salesSaleReferenceSequence,
    return: manifest.returnsReturnReferenceSequence,
  };
}

async function restoreReferenceSequences(features: RestoreFeatureSet, sequences: ReferenceSequences) {
  await features.onlineOrders.restoreReferenceSequence(sequences.onlineOrder);
  await features.sales.restoreReferenceSequence(sequences.physicalSale);
  await features.returns.restoreReferenceSequence(sequences.return);
}

function laterSequences(left: ReferenceSequences, right: ReferenceSequences): ReferenceSequences {
  return {
    onlineOrder: laterSequence(left.onlineOrder, right.onlineOrder),
    physicalSale: laterSequence(left.physicalSale, right.physicalSale),
    return: laterSequence(left.return, right.return),
  };
}

function laterSequence(left: SequenceState, right: SequenceState): SequenceState {
  const leftNext = BigInt(left.lastValue) + (left.isCalled ? 1n : 0n);
  const rightNext = BigInt(right.lastValue) + (right.isCalled ? 1n : 0n);
  return { lastValue: (leftNext > rightNext ? leftNext : rightNext).toString(), isCalled: false };
}

function flattenData(data: BackupData): RestoreTables {
  return new Map(Object.values(data).flatMap((section) => Object.entries(section)));
}

function tablesByName(tables: BackupTableSnapshot[]): RestoreTables {
  return new Map(tables.map((table) => [table.tableName, table.rows]));
}

function differencesFor(archived: BackupManifest, live: BackupManifest): RestoreDifferenceDto[] {
  const current = new Map(live.sections.map((section) => [section.name, section.recordCount]));
  return archived.sections.map((section) => ({
    section: section.name,
    archivedRecordCount: section.recordCount,
    liveRecordCount: current.get(section.name) ?? 0,
    restoredRecordCount: 0,
    archiveOnlyRecordCount: 0,
    liveOnlyRecordCount: 0,
    conflictingRecordCount: 0,
    difference: (current.get(section.name) ?? 0) - section.recordCount,
  }));
}

async function adminQuery(databaseUrl: string, sql: string, parameters: unknown[] = []) {
  const admin = new Pool({ connectionString: databaseUrlFor(databaseUrl, "postgres"), max: 1 });
  try {
    await admin.query(sql, parameters);
  } finally {
    await admin.end();
  }
}

async function dropStage(databaseUrl: string, name: string) {
  quotedDatabase(name);
  await adminQuery(databaseUrl, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [name]);
  await adminQuery(databaseUrl, `DROP DATABASE IF EXISTS ${quotedDatabase(name)}`);
}

function databaseUrlFor(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function quotedDatabase(name: string) {
  if (!/^(postgres|bravos_restore_stage_[0-9a-f]{32})$/.test(name)) throw new Error("Unsafe database name.");
  return `"${name}"`;
}

async function getPreview(queryable: Queryable, id: string, lock = false) {
  const result = await queryable.query<PreviewRow>(
    `SELECT ${PREVIEW_COLUMNS} FROM restore_preview WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function getPreviewByOperation(queryable: Queryable, operationId: string) {
  const result = await queryable.query<PreviewRow>(`SELECT ${PREVIEW_COLUMNS} FROM restore_preview WHERE operation_id = $1`, [operationId]);
  return result.rows[0] ?? null;
}

function assertReplay(row: PreviewRow, payloadFingerprint: string) {
  if (row.payload_fingerprint !== payloadFingerprint) throw new RestoreStaleError("تم استخدام معرّف العملية نفسه ببيانات مختلفة.");
  return row;
}

async function deviceRows(queryable: Queryable, previewId: string) {
  return (await queryable.query<DeviceRow>(
    `SELECT device_id, staff_id, known_snapshot_id, known_snapshot_at, known_stock_version::text,
       known_restore_generation::text, pending_operation_ids, custodied_operation_ids, synchronization_complete,
       acknowledged_snapshot_id, acknowledged_at
     FROM restore_preview_till WHERE preview_id = $1 ORDER BY device_id`,
    [previewId],
  )).rows;
}

async function previewDto(queryable: Queryable, row: PreviewRow, liveTills: RestoreKnownTill[]): Promise<RestorePreviewDto> {
  const recorded = await deviceRows(queryable, row.id);
  const known = new Set(recorded.map((device) => device.device_id));
  const devices: RestoreDeviceDto[] = [
    ...recorded.map((device) => ({
      deviceId: device.device_id,
      staffId: device.staff_id,
      knownSnapshotId: device.known_snapshot_id,
      knownSnapshotAt: device.known_snapshot_at.toISOString(),
      knownStockVersion: device.known_stock_version,
      knownRestoreGeneration: Number(device.known_restore_generation),
      pendingOperationIds: device.pending_operation_ids,
      custodiedOperationIds: device.custodied_operation_ids,
      synchronizationComplete: device.synchronization_complete,
      acknowledgedSnapshotId: device.acknowledged_snapshot_id,
      acknowledgedAt: device.acknowledged_at?.toISOString() ?? null,
    })),
    ...liveTills.filter((till) => !known.has(till.deviceId)).map((till) => ({
      deviceId: till.deviceId,
      staffId: till.staffId,
      knownSnapshotId: till.latestSnapshotId,
      knownSnapshotAt: till.latestSnapshotAt.toISOString(),
      knownStockVersion: till.stockVersion,
      knownRestoreGeneration: till.restoreGeneration,
      pendingOperationIds: till.pendingOperationIds,
      custodiedOperationIds: [],
      synchronizationComplete: till.synchronizationComplete,
      acknowledgedSnapshotId: null,
      acknowledgedAt: null,
    })),
  ].sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  return {
    id: row.id,
    operationId: row.operation_id,
    status: row.status,
    backupId: row.backup_id,
    archiveSha256: row.archive_sha256,
    archiveSchemaVersion: row.archive_schema_version,
    sourceGeneration: row.source_generation === null ? null : Number(row.source_generation),
    expectedGeneration: Number(row.expected_generation),
    previewFingerprint: row.preview_fingerprint,
    totalRecordCount: row.manifest_json.totalRecordCount,
    differences: row.differences_json,
    blockingReasons: row.blocking_reasons_json,
    devices,
    preRestoreBackupId: row.pre_restore_backup_id,
    preRestoreArchiveSha256: row.pre_restore_archive_sha256,
    preRestoreDownloadAcknowledgedAt: row.pre_restore_download_acknowledged_at?.toISOString() ?? null,
    createdByStaffId: row.created_by_staff_id,
    createdAt: row.created_at.toISOString(),
    pausedAt: row.paused_at?.toISOString() ?? null,
    activatedAt: row.activated_at?.toISOString() ?? null,
  };
}

function stateDto(row: { current_generation: string; paused_preview_id: string | null; paused_at: Date | null }): RestoreStateDto {
  return {
    currentGeneration: Number(row.current_generation),
    pause: row.paused_preview_id && row.paused_at
      ? { previewId: row.paused_preview_id, generation: Number(row.current_generation), pausedAt: row.paused_at.toISOString() }
      : null,
  };
}

type ActivationRow = { payload_fingerprint: string; preview_id: string };

async function activationByOperation(queryable: Queryable, operationId: string) {
  return (await queryable.query<ActivationRow>(
    "SELECT payload_fingerprint, preview_id FROM restore_activation WHERE operation_id = $1",
    [operationId],
  )).rows[0] ?? null;
}

async function activationReplay(
  row: ActivationRow,
  payloadFingerprint: string,
  queryable: Queryable,
  dto: (row: PreviewRow) => Promise<RestorePreviewDto>,
) {
  if (row.payload_fingerprint !== payloadFingerprint) throw new RestoreStaleError("تم استخدام معرّف العملية نفسه ببيانات مختلفة.");
  const preview = await getPreview(queryable, row.preview_id);
  if (!preview) throw new RestoreStaleError();
  return { value: await dto(preview), created: false };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

import {
  BACKUP_SECTION_NAMES,
  OPERATIONAL_STOCK_SCHEMA,
  type BackupCreateRequest,
  type BackupReadinessDto,
  type BackupSectionCounts,
  type BackupSectionName,
  type BackupTableSnapshot,
} from "@bravos/contracts";
import { ForbiddenError, UnauthenticatedError, isManager } from "@bravos/identity";
import { canonicalJson, canonicalJsonUtf8ByteLength, normalizeBackupValue } from "../domain/canonical-json.ts";
import { BackupInProgressError, BackupValidationError } from "../domain/errors.ts";
import type {
  BackupActorPort,
  BackupCryptoPort,
  BackupData,
  BackupManifest,
  BackupReaderSet,
  BackupSequenceState,
  BackupServices,
  BackupSnapshotMetadata,
  BackupUnitOfWork,
  VerifiedAuth,
} from "./ports.ts";

export const BACKUP_TABLE_SECTIONS: Record<string, BackupSectionName> = {
  identity_actor: "identity",
  branch: "identity",
  staff_profile: "identity",
  staff_branch_grant: "identity",
  staff_operation: "identity",
  catalog_category: "catalog",
  catalog_size: "catalog",
  catalog_color: "catalog",
  catalog_product: "catalog",
  catalog_product_variant: "catalog",
  inventory_settings: "inventory",
  inventory_variant_setting: "inventory",
  inventory_stock_clock: "inventory",
  inventory_operation: "inventory",
  inventory_batch: "inventory",
  inventory_batch_balance: "inventory",
  inventory_movement: "inventory",
  inventory_allocation: "inventory",
  inventory_discrepancy: "inventory",
  inventory_known_till: "inventory",
  inventory_count_coordination: "inventory",
  inventory_count_coordination_device: "inventory",
  inventory_stock_correction: "inventory",
  inventory_stock_correction_batch: "inventory",
  inventory_stock_reconciliation: "inventory",
  inventory_stock_reconciliation_batch: "inventory",
  inventory_protected_order: "inventory",
  inventory_protected_order_allocation: "inventory",
  inventory_order_disposition: "inventory",
  inventory_order_disposition_allocation: "inventory",
  inventory_delivered_return_allocation_effect: "inventory",
  inventory_transfer: "inventory",
  supplier: "receiving",
  receiving_receipt: "receiving",
  receiving_receipt_line: "receiving",
  receiving_correction: "receiving",
  receiving_correction_line: "receiving",
  sales_pos_snapshot: "sales",
  sales_pos_snapshot_price: "sales",
  sales_sale: "sales",
  sales_sale_line: "sales",
  sales_sale_unit: "sales",
  sales_restore_deferred_completion: "sales",
  sales_receipt_registration: "sales",
  customer: "sales",
  expense_category: "expenses",
  expense_operation: "expenses",
  expense_record: "expenses",
  expense_change: "expenses",
  pricing_automatic_offer: "pricing",
  pricing_automatic_offer_product: "pricing",
  pricing_automatic_offer_category: "pricing",
  pricing_automatic_offer_bundle_item: "pricing",
  pricing_automatic_offer_buy_product: "pricing",
  pricing_automatic_offer_buy_category: "pricing",
  pricing_automatic_offer_reward_product: "pricing",
  pricing_automatic_offer_reward_category: "pricing",
  pricing_coupon: "pricing",
  pricing_coupon_product: "pricing",
  pricing_coupon_category: "pricing",
  pricing_coupon_usage: "pricing",
  returns_return: "returns",
  returns_return_line: "returns",
  returns_return_unit: "returns",
  returns_batch_restoration: "returns",
  returns_refund_event: "returns",
  returns_exchange_quote: "returns",
  returns_exchange: "returns",
  recording_correction: "corrections",
  recording_sale_line_value: "corrections",
  recording_sale_unit_value: "corrections",
  recording_return_line_value: "corrections",
  recording_merchandise_fact: "corrections",
  recording_online_return_unit_value: "corrections",
  online_checkout_quote: "online_orders",
  online_order: "online_orders",
  online_order_line: "online_orders",
  online_order_agreement_quote: "online_orders",
  online_order_operation: "online_orders",
  online_order_contact_attempt: "online_orders",
  online_order_agreed_revision: "online_orders",
  online_order_confirmation: "online_orders",
  online_order_unreachable_cancellation: "online_orders",
  online_order_fulfillment_event: "online_orders",
  online_order_failed_return_inspection: "online_orders",
  online_order_failed_return_inspection_line: "online_orders",
  storefront_contacts: "storefront_configuration",
  delivery_area: "storefront_configuration",
  online_order_settings: "storefront_configuration",
  opening_import_preview: "opening_import",
  public_analytics_event: "analytics",
};

export const EXPECTED_BACKUP_TABLES = new Set(Object.keys(BACKUP_TABLE_SECTIONS));

// Named profiles only. A later migration is not accepted by comparing version numbers.
export const RECEIPT_NUMBERING_SCHEMA = "036_receipt_numbering.sql";

export const KNOWN_BACKUP_SCHEMAS = [
  "028_aggregate_analytics.sql",
  "029_restore.sql",
  "030_branch_inventory.sql",
  "031_sale_payments.sql",
  "032_catalog_online_variants.sql",
  "033_human_references.sql",
  "034_order_recognition_branch.sql",
  "035_return_reason.sql",
  "036_receipt_numbering.sql",
  OPERATIONAL_STOCK_SCHEMA,
] as const;

const OPERATIONAL_TABLES = new Set(["supplier", "customer", "inventory_transfer"]);

export function expectedBackupTables(schemaVersion: string, sourceGeneration: number | null): Set<string> {
  const schemaIndex = (KNOWN_BACKUP_SCHEMAS as readonly string[]).indexOf(schemaVersion);
  if (schemaIndex < 0) throw new Error(`Unsupported backup schema profile: ${schemaVersion}`);
  const schemaNumber = schemaIndex + 28;
  const legacy028 = schemaVersion === "028_aggregate_analytics.sql" && sourceGeneration === null;
  const keepsReceiptRegistry = schemaVersion === RECEIPT_NUMBERING_SCHEMA || schemaVersion === OPERATIONAL_STOCK_SCHEMA;
  return new Set([...EXPECTED_BACKUP_TABLES].filter((name) =>
    !(legacy028 && name === "sales_restore_deferred_completion")
    && !(schemaNumber < 30 && name === "inventory_batch_balance")
    && !(!keepsReceiptRegistry && name === "sales_receipt_registration")
    && !(schemaVersion !== OPERATIONAL_STOCK_SCHEMA && OPERATIONAL_TABLES.has(name))));
}

export const DEFAULT_MAX_BACKUP_PAYLOAD_BYTES = 128 * 1024 * 1024;

export function createBackupServices(deps: {
  actors: BackupActorPort;
  unitOfWork: BackupUnitOfWork;
  crypto: BackupCryptoPort;
  idGenerator?: { randomUuid(): string };
  maxPayloadBytes?: number;
}): BackupServices {
  const randomUuid = deps.idGenerator?.randomUuid ?? (() => crypto.randomUUID());
  const maxPayloadBytes = deps.maxPayloadBytes ?? DEFAULT_MAX_BACKUP_PAYLOAD_BYTES;
  let creating = false;
  return {
    async readiness(auth) {
      await requireManager(auth, deps.actors);
      return deps.unitOfWork.run(async (transaction) => readinessDto(
        await transaction.readers.inventory.listKnownUnsynchronizedTills(),
      ));
    },
    async create(auth, unknownInput) {
      const actor = await requireManager(auth, deps.actors);
      const input = createRequest(unknownInput);
      if (creating) throw new BackupInProgressError();
      creating = true;
      try {
        return await createBackup(actor.id, input.password);
      } finally {
        creating = false;
      }
    },
  };

  async function createBackup(actorId: string, password: string) {
      const backupId = randomUuid();
      const payload = await deps.unitOfWork.run(async (transaction) => {
        const metadata = await transaction.metadata();
        const knownTills = await transaction.readers.inventory.listKnownUnsynchronizedTills();
        const tables = await readAllTables(transaction.readers, maxPayloadBytes);
        const data = buildData(tables, metadata.schemaVersion, metadata.sourceGeneration);
        const sections = BACKUP_SECTION_NAMES.map((name) => {
          const tableEntries = Object.entries(data[name]).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
          const recordCount = tableEntries.reduce((sum, [, rows]) => sum + rows.length, 0);
          return {
            name,
            recordCount,
            sha256: deps.crypto.sha256(canonicalJson(data[name])),
            tables: tableEntries.map(([tableName, rows]) => ({ name: tableName, recordCount: rows.length })),
          };
        });
        const manifest: BackupManifest = {
          format: "bravos-business-data",
          formatVersion: 1,
          backupId,
          createdAt: metadata.capturedAt,
          schemaVersion: metadata.schemaVersion,
          sourceGeneration: metadata.sourceGeneration,
          createdByStaffId: actorId,
          stockVersion: metadata.stockVersion,
          onlineOrderReferenceSequence: metadata.onlineOrderReferenceSequence,
          salesSaleReferenceSequence: metadata.salesSaleReferenceSequence,
          returnsReturnReferenceSequence: metadata.returnsReturnReferenceSequence,
          ...(receiptPrefixMetadata(metadata)),
          identityPolicy: { preservesStableIds: true, preservesForeignKeys: true, regeneratesIds: false },
          idProvenance: {
            source: "database_primary_and_foreign_keys",
            stableIdsPreserved: true,
            foreignKeysPreserved: true,
            idsRegenerated: false,
          },
          sections,
          totalRecordCount: sections.reduce((sum, section) => sum + section.recordCount, 0),
          knownUnsynchronizedTills: knownTills,
          includesUnsentBrowserRecords: false,
          imageBinariesIncluded: false,
          imageReferencesPreserved: true,
          excludedData: ["credentials", "sessions", "reset_tokens", "service_secrets", "image_binaries", "unsent_browser_records"],
        };
        return { manifest, data };
      });
      const bytes = await deps.crypto.protect(payload, password);
      const sectionCounts = Object.fromEntries(payload.manifest.sections.map((section) => [section.name, section.recordCount])) as BackupSectionCounts;
      return {
        bytes,
        manifest: payload.manifest,
        sectionCounts,
        archiveSha256: deps.crypto.sha256(bytes),
        fileName: `bravos-business-backup-${payload.manifest.createdAt.replaceAll(":", "-").replaceAll(".", "-")}.bravos-backup`,
      };
  }
}

async function requireManager(auth: VerifiedAuth | null, actors: BackupActorPort) {
  if (!auth) throw new UnauthenticatedError();
  const actor = await actors.getStaff(auth.staffId);
  if (!actor || actor.disabled) throw new UnauthenticatedError();
  if (!isManager(actor)) throw new ForbiddenError();
  return actor;
}

function createRequest(value: unknown): BackupCreateRequest {
  if (!isRecord(value) || typeof value.password !== "string") {
    throw new BackupValidationError("بيانات إنشاء النسخة الاحتياطية غير صالحة.");
  }
  const length = [...value.password].length;
  if (length < 12 || length > 128) {
    throw new BackupValidationError("يجب أن تتكون كلمة مرور النسخة الاحتياطية من 12 إلى 128 حرفًا.");
  }
  return { password: value.password };
}

function readinessDto(knownUnsynchronizedTills: BackupReadinessDto["knownUnsynchronizedTills"]): BackupReadinessDto {
  return {
    knownUnsynchronizedTills,
    knownUnsynchronizedTillCount: knownUnsynchronizedTills.length,
    includesUnsentBrowserRecords: false,
    imageBinariesIncluded: false,
    imageReferencesPreserved: true,
  };
}

async function readAllTables(readers: BackupReaderSet, maxPayloadBytes: number): Promise<BackupTableSnapshot[]> {
  const result: BackupTableSnapshot[] = [];
  let estimatedBytes = 0;
  for (const reader of [
    readers.identity,
    readers.catalog,
    readers.inventory,
    readers.receiving,
    readers.sales,
    readers.expenses,
    readers.pricing,
    readers.returns,
    readers.corrections,
    readers.onlineOrders,
    readers.storefrontConfiguration,
    readers.openingImport,
    readers.analytics,
  ]) {
    const tables = await reader.readBackupTables();
    for (const table of tables) {
      estimatedBytes += canonicalJsonUtf8ByteLength(table.rows);
      if (estimatedBytes > maxPayloadBytes) {
        throw new BackupValidationError("حجم بيانات النسخة الاحتياطية يتجاوز الحد المدعوم لهذا الخادم.");
      }
    }
    result.push(...tables);
  }
  return result;
}

function receiptPrefixMetadata(metadata: BackupSnapshotMetadata): { salesReceiptPrefixSequence: BackupSequenceState } | Record<string, never> {
  if (metadata.schemaVersion === RECEIPT_NUMBERING_SCHEMA || metadata.schemaVersion === OPERATIONAL_STOCK_SCHEMA) {
    if (!metadata.salesReceiptPrefixSequence) throw new Error("Receipt prefix sequence is missing from backup metadata.");
    return { salesReceiptPrefixSequence: metadata.salesReceiptPrefixSequence };
  }
  if (metadata.salesReceiptPrefixSequence) {
    throw new Error("Historical backup metadata must not include a receipt prefix sequence.");
  }
  return {};
}

function buildData(tables: BackupTableSnapshot[], schemaVersion: string, sourceGeneration: number | null): BackupData {
  const expected = expectedBackupTables(schemaVersion, sourceGeneration);
  const data = Object.fromEntries(BACKUP_SECTION_NAMES.map((name) => [name, {}])) as BackupData;
  const seen = new Set<string>();
  for (const table of tables) {
    const section = BACKUP_TABLE_SECTIONS[table.tableName];
    if (!section || seen.has(table.tableName) || !expected.has(table.tableName)) {
      throw new Error(`Backup reader returned an unapproved or duplicate table: ${table.tableName}`);
    }
    seen.add(table.tableName);
    data[section][table.tableName] = table.rows.map((row) => normalizeBackupValue(row) as Record<string, unknown>);
  }
  const missing = [...expected].filter((tableName) => !seen.has(tableName));
  if (missing.length > 0) throw new Error(`Backup reader omitted required tables: ${missing.join(", ")}`);
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

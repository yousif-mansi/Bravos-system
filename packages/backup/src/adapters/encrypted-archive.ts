import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
} from "node:crypto";
import { BACKUP_SECTION_NAMES, type BackupSectionName } from "@bravos/contracts";
import { BACKUP_TABLE_SECTIONS, EXPECTED_BACKUP_TABLES } from "../application/backup.ts";
import type { BackupCryptoPort, DecodedBackupArchive } from "../application/ports.ts";
import { canonicalJson, canonicalJsonUtf8ByteLength } from "../domain/canonical-json.ts";
import { BackupArchiveError } from "../domain/errors.ts";

const MAGIC = Buffer.from("BRAVOS-BACKUP\n1\n", "ascii");
const MAX_ARCHIVE_BYTES = 192 * 1024 * 1024;
const SCRYPT = { algorithm: "scrypt" as const, N: 32_768, r: 8, p: 1, keyLength: 32, maxMemoryBytes: 64 * 1024 * 1024 };
const TAG_LENGTH = 16;

type EnvelopeHeader = {
  format: "bravos-encrypted-backup";
  formatVersion: 1;
  kdf: typeof SCRYPT & { salt: string };
  cipher: {
    algorithm: "aes-256-gcm";
    nonce: string;
    authenticationTagLength: 16;
  };
};

type Envelope = Omit<EnvelopeHeader, "cipher"> & {
  cipher: EnvelopeHeader["cipher"] & { authenticationTag: string };
  ciphertext: string;
};

export function createNodeBackupCrypto(options: { maxArchiveBytes?: number } = {}): BackupCryptoPort {
  const maxArchiveBytes = boundedArchiveLimit(options.maxArchiveBytes);
  return {
    sha256,
    async protect(payload, password) {
      const plaintextByteLength = canonicalJsonUtf8ByteLength(payload);
      if (archiveByteLength(plaintextByteLength) > maxArchiveBytes) {
        throw new BackupArchiveError("حجم بيانات النسخة الاحتياطية يتجاوز الحد المدعوم.");
      }
      const salt = randomBytes(16);
      const nonce = randomBytes(12);
      const header: EnvelopeHeader = {
        format: "bravos-encrypted-backup",
        formatVersion: 1,
        kdf: { ...SCRYPT, salt: salt.toString("base64url") },
        cipher: { algorithm: "aes-256-gcm", nonce: nonce.toString("base64url"), authenticationTagLength: TAG_LENGTH },
      };
      const key = await deriveKey(password, salt);
      const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_LENGTH });
      cipher.setAAD(Buffer.from(canonicalJson(header), "utf8"));
      const plaintext = Buffer.from(canonicalJson(payload), "utf8");
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const envelope: Envelope = {
        ...header,
        cipher: { ...header.cipher, authenticationTag: cipher.getAuthTag().toString("base64url") },
        ciphertext: ciphertext.toString("base64url"),
      };
      return Buffer.concat([MAGIC, Buffer.from(canonicalJson(envelope), "utf8")]);
    },
  };
}

function boundedArchiveLimit(value: number | undefined): number {
  if (value === undefined) return MAX_ARCHIVE_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_ARCHIVE_BYTES) {
    throw new Error("Invalid backup archive size limit.");
  }
  return value;
}

function archiveByteLength(plaintextByteLength: number): number {
  const placeholderHeader: EnvelopeHeader = {
    format: "bravos-encrypted-backup",
    formatVersion: 1,
    kdf: { ...SCRYPT, salt: "A".repeat(base64UrlByteLength(16)) },
    cipher: {
      algorithm: "aes-256-gcm",
      nonce: "A".repeat(base64UrlByteLength(12)),
      authenticationTagLength: TAG_LENGTH,
    },
  };
  const placeholderEnvelope: Envelope = {
    ...placeholderHeader,
    cipher: {
      ...placeholderHeader.cipher,
      authenticationTag: "A".repeat(base64UrlByteLength(TAG_LENGTH)),
    },
    ciphertext: "",
  };
  return MAGIC.length
    + canonicalJsonUtf8ByteLength(placeholderEnvelope)
    + base64UrlByteLength(plaintextByteLength);
}

function base64UrlByteLength(sourceBytes: number): number {
  return Math.floor((sourceBytes * 4 + 2) / 3);
}

export async function decodeBackupArchive(bytes: Uint8Array, password: string): Promise<DecodedBackupArchive> {
  try {
    if (typeof password !== "string" || [...password].length > 128) throw new Error("Invalid backup password.");
    const source = Buffer.from(bytes);
    if (source.length <= MAGIC.length || source.length > MAX_ARCHIVE_BYTES || !source.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("Invalid archive framing.");
    }
    const parsed = JSON.parse(source.subarray(MAGIC.length).toString("utf8")) as unknown;
    const envelope = parseEnvelope(parsed);
    const salt = decodeBase64Url(envelope.kdf.salt, 16);
    const nonce = decodeBase64Url(envelope.cipher.nonce, 12);
    const tag = decodeBase64Url(envelope.cipher.authenticationTag, TAG_LENGTH);
    const ciphertext = decodeBase64Url(envelope.ciphertext);
    const header: EnvelopeHeader = {
      format: envelope.format,
      formatVersion: envelope.formatVersion,
      kdf: { ...SCRYPT, salt: envelope.kdf.salt },
      cipher: {
        algorithm: envelope.cipher.algorithm,
        nonce: envelope.cipher.nonce,
        authenticationTagLength: TAG_LENGTH,
      },
    };
    const key = await deriveKey(password, salt);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_LENGTH });
    decipher.setAAD(Buffer.from(canonicalJson(header), "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const payload = JSON.parse(plaintext.toString("utf8")) as unknown;
    return validatePayload(payload);
  } catch (error) {
    if (error instanceof BackupArchiveError) throw error;
    throw new BackupArchiveError("تعذر فتح النسخة الاحتياطية. تحقق من كلمة المرور وسلامة الملف.", { cause: error });
  }
}

function parseEnvelope(value: unknown): Envelope {
  if (!isRecord(value) || value.format !== "bravos-encrypted-backup" || value.formatVersion !== 1
    || !isRecord(value.kdf) || value.kdf.algorithm !== SCRYPT.algorithm || value.kdf.N !== SCRYPT.N
    || value.kdf.r !== SCRYPT.r || value.kdf.p !== SCRYPT.p || value.kdf.keyLength !== SCRYPT.keyLength
    || value.kdf.maxMemoryBytes !== SCRYPT.maxMemoryBytes || typeof value.kdf.salt !== "string"
    || !isRecord(value.cipher) || value.cipher.algorithm !== "aes-256-gcm"
    || value.cipher.authenticationTagLength !== TAG_LENGTH || typeof value.cipher.nonce !== "string"
    || typeof value.cipher.authenticationTag !== "string" || typeof value.ciphertext !== "string") {
    throw new Error("Unsupported encrypted backup envelope.");
  }
  assertExactKeys(value, ["format", "formatVersion", "kdf", "cipher", "ciphertext"]);
  assertExactKeys(value.kdf, ["algorithm", "N", "r", "p", "keyLength", "maxMemoryBytes", "salt"]);
  assertExactKeys(value.cipher, ["algorithm", "nonce", "authenticationTagLength", "authenticationTag"]);
  return value as Envelope;
}

function validatePayload(value: unknown): DecodedBackupArchive {
  if (!isRecord(value) || !isRecord(value.manifest) || !isRecord(value.data)) {
    throw new Error("Invalid backup payload.");
  }
  const manifest = value.manifest;
  if (manifest.format !== "bravos-business-data" || manifest.formatVersion !== 1
    || typeof manifest.backupId !== "string" || !UUID_PATTERN.test(manifest.backupId)
    || typeof manifest.createdAt !== "string" || !isIsoInstant(manifest.createdAt)
    || typeof manifest.schemaVersion !== "string" || !/^\d{3}_.+\.sql$/.test(manifest.schemaVersion)
    || !(manifest.sourceGeneration === null || isCount(manifest.sourceGeneration))
    || typeof manifest.createdByStaffId !== "string"
    || typeof manifest.stockVersion !== "string" || !/^\d+$/.test(manifest.stockVersion)
    || !isRecord(manifest.onlineOrderReferenceSequence)
    || typeof manifest.onlineOrderReferenceSequence.lastValue !== "string"
    || !/^\d+$/.test(manifest.onlineOrderReferenceSequence.lastValue)
    || typeof manifest.onlineOrderReferenceSequence.isCalled !== "boolean"
    || !isRecord(manifest.identityPolicy)
    || manifest.identityPolicy.preservesStableIds !== true
    || manifest.identityPolicy.preservesForeignKeys !== true
    || manifest.identityPolicy.regeneratesIds !== false
    || !isRecord(manifest.idProvenance)
    || manifest.idProvenance.source !== "database_primary_and_foreign_keys"
    || manifest.idProvenance.stableIdsPreserved !== true
    || manifest.idProvenance.foreignKeysPreserved !== true
    || manifest.idProvenance.idsRegenerated !== false
    || !Array.isArray(manifest.sections) || manifest.sections.length !== BACKUP_SECTION_NAMES.length
    || !isCount(manifest.totalRecordCount)
    || !Array.isArray(manifest.knownUnsynchronizedTills)
    || manifest.includesUnsentBrowserRecords !== false || manifest.imageBinariesIncluded !== false
    || manifest.imageReferencesPreserved !== true
    || JSON.stringify(manifest.excludedData) !== JSON.stringify(["credentials", "sessions", "reset_tokens", "service_secrets", "image_binaries", "unsent_browser_records"])) {
    throw new Error("Invalid backup manifest.");
  }
  validateKnownTills(manifest.knownUnsynchronizedTills);
  // Format 1 retains explicit schema profiles. A previous schema can be authenticated and
  // diagnosed by restore, but cannot be silently interpreted as the current schema.
  const knownSchemas = [
    "028_aggregate_analytics.sql", "029_restore.sql", "030_branch_inventory.sql",
    "031_sale_payments.sql", "032_catalog_online_variants.sql",
    "033_human_references.sql", "034_order_recognition_branch.sql",
  ];
  const schemaNumber = knownSchemas.indexOf(manifest.schemaVersion as string) + 28;
  if (schemaNumber < 28) {
    throw new Error("Unsupported backup schema version. Use a backup made by a compatible server.");
  }
  const legacy028 = manifest.schemaVersion === "028_aggregate_analytics.sql" && manifest.sourceGeneration === null;
  const generationAware = schemaNumber >= 29 && isCount(manifest.sourceGeneration);
  if (!legacy028 && !generationAware) throw new Error("Unsupported backup schema or generation profile.");
  const referenceAware = schemaNumber >= 33;
  if (referenceAware) {
    validateReferenceSequence(manifest.salesSaleReferenceSequence, "physical-sale");
    validateReferenceSequence(manifest.returnsReturnReferenceSequence, "return");
  } else if ("salesSaleReferenceSequence" in manifest || "returnsReturnReferenceSequence" in manifest) {
    throw new Error("Backup reference sequences do not match its schema version.");
  }
  const expectedTables = new Set([...EXPECTED_BACKUP_TABLES].filter((name) =>
    !(legacy028 && name === "sales_restore_deferred_completion")
    && !(schemaNumber < 30 && name === "inventory_batch_balance")));
  const data = value.data;
  const sectionKeys = Object.keys(data);
  if (sectionKeys.length !== BACKUP_SECTION_NAMES.length || BACKUP_SECTION_NAMES.some((name) => !isRecord(data[name]))) {
    throw new Error("Backup sections do not match this format version.");
  }
  const seenTables = new Set<string>();
  let total = 0;
  for (let index = 0; index < BACKUP_SECTION_NAMES.length; index += 1) {
    const sectionName = BACKUP_SECTION_NAMES[index]!;
    const sectionManifest = manifest.sections[index];
    const sectionData = data[sectionName] as Record<string, unknown>;
    if (!isRecord(sectionManifest) || sectionManifest.name !== sectionName || !Array.isArray(sectionManifest.tables)
      || !isCount(sectionManifest.recordCount) || typeof sectionManifest.sha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(sectionManifest.sha256)) {
      throw new Error(`Invalid ${sectionName} section manifest.`);
    }
    let sectionCount = 0;
    const tableNames = Object.keys(sectionData);
    if (sectionManifest.tables.length !== tableNames.length) throw new Error(`Invalid ${sectionName} table manifest.`);
    for (let tableIndex = 0; tableIndex < tableNames.length; tableIndex += 1) {
      const tableName = tableNames[tableIndex]!;
      const rows = sectionData[tableName];
      const tableManifest = sectionManifest.tables[tableIndex];
      if (BACKUP_TABLE_SECTIONS[tableName] !== sectionName || seenTables.has(tableName) || !Array.isArray(rows)
        || !isRecord(tableManifest) || tableManifest.name !== tableName || tableManifest.recordCount !== rows.length
        || rows.some((row) => !isRecord(row))) {
        throw new Error(`Invalid or unapproved backup table ${tableName}.`);
      }
      seenTables.add(tableName);
      sectionCount += rows.length;
    }
    if (sectionManifest.recordCount !== sectionCount || sectionManifest.sha256 !== sha256(canonicalJson(sectionData))) {
      throw new Error(`Backup checksum or count mismatch in ${sectionName}.`);
    }
    total += sectionCount;
  }
  if (seenTables.size !== expectedTables.size || [...expectedTables].some((name) => !seenTables.has(name))
    || manifest.totalRecordCount !== total) {
    throw new Error("Backup table inventory or total count is incomplete.");
  }
  validateGenerationColumns(data, generationAware);
  validateActorProjection((data.identity as Record<string, unknown>).identity_actor);
  return value as unknown as DecodedBackupArchive;
}

function validateReferenceSequence(value: unknown, label: string): void {
  if (!isRecord(value) || Object.keys(value).length !== 2
    || typeof value.lastValue !== "string" || !/^(0|[1-9]\d*)$/.test(value.lastValue)
    || typeof value.isCalled !== "boolean") {
    throw new Error(`Invalid ${label} reference sequence in backup manifest.`);
  }
}

function validateGenerationColumns(data: Record<string, unknown>, generationAware: boolean) {
  const sales = data.sales as Record<string, unknown>;
  validateGenerationRows(sales.sales_pos_snapshot, "restore_generation", generationAware);
  validateGenerationRows(sales.sales_sale, "source_restore_generation", generationAware);
  const knownTills = (data.inventory as Record<string, unknown>).inventory_known_till;
  // The destination assigns its own generation to known tills; it is never archived.
  if (!Array.isArray(knownTills) || knownTills.some((row) => !isRecord(row) || "restore_generation" in row)) {
    throw new Error("Known-till restore generation must not be archived.");
  }
}

function validateGenerationRows(value: unknown, column: string, required: boolean) {
  if (!Array.isArray(value)) throw new Error("Missing sales generation table.");
  for (const row of value) {
    if (!isRecord(row)) throw new Error("Invalid sales generation row.");
    const present = Object.prototype.hasOwnProperty.call(row, column);
    if (required) {
      const archived = row[column];
      if (!present || typeof archived !== "string" || !/^(0|[1-9]\d*)$/.test(archived) || !Number.isSafeInteger(Number(archived))) {
        throw new Error(`Generation-aware backup row requires a valid ${column}.`);
      }
    } else if (present) {
      throw new Error(`Legacy backup row must not contain ${column}.`);
    }
  }
}

function validateActorProjection(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Missing sanitized actor projection.");
  const allowed = new Set(["id", "username", "display_username", "role", "disabled", "disable_reason", "disable_expires_at", "created_at", "updated_at"]);
  for (const actor of value) {
    if (!isRecord(actor) || typeof actor.id !== "string" || typeof actor.username !== "string"
      || (actor.role !== "manager" && actor.role !== "employee") || typeof actor.disabled !== "boolean"
      || Object.keys(actor).some((key) => !allowed.has(key))) {
      throw new Error("Actor projection contains an unapproved field.");
    }
  }
}

function validateKnownTills(value: unknown[]) {
  const deviceIds = new Set<string>();
  for (const till of value) {
    if (!isRecord(till) || typeof till.deviceId !== "string" || !UUID_PATTERN.test(till.deviceId)
      || typeof till.staffId !== "string" || typeof till.latestSnapshotId !== "string" || !UUID_PATTERN.test(till.latestSnapshotId)
      || typeof till.latestSnapshotAt !== "string" || !isIsoInstant(till.latestSnapshotAt)
      || !(till.stockVersion === null || (typeof till.stockVersion === "string" && /^\d+$/.test(till.stockVersion)))
      || !Array.isArray(till.pendingOperationIds) || till.pendingOperationIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))
      || !isCount(till.pendingOperationCount) || till.pendingOperationCount !== till.pendingOperationIds.length) {
      throw new Error("Invalid known-unsynchronized-till manifest entry.");
    }
    if (deviceIds.has(till.deviceId as string)) throw new Error("Duplicate known till in backup manifest.");
    deviceIds.add(till.deviceId as string);
  }
}

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(Buffer.from(password, "utf8"), salt, SCRYPT.keyLength, {
      N: SCRYPT.N,
      r: SCRYPT.r,
      p: SCRYPT.p,
      maxmem: SCRYPT.maxMemoryBytes,
    }, (error, key) => {
      if (error) reject(error);
      else resolve(Buffer.from(key));
    });
  });
}

function decodeBase64Url(value: string, exactLength?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url data.");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value || (exactLength !== undefined && decoded.length !== exactLength)) {
    throw new Error("Invalid base64url length or encoding.");
  }
  return decoded;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isIsoInstant(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function assertExactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error("Archive object contains unsupported fields.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

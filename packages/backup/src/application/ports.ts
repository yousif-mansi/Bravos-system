import type {
  BackupKnownUnsynchronizedTillDto,
  BackupReadinessDto,
  BackupSectionCounts,
  BackupSectionName,
  BackupTableSnapshot,
} from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";

export type { VerifiedAuth };

export type BackupActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
};

export type BackupTableReader = {
  readBackupTables(): Promise<BackupTableSnapshot[]>;
};

export type BackupInventoryReader = BackupTableReader & {
  listKnownUnsynchronizedTills(): Promise<BackupKnownUnsynchronizedTillDto[]>;
  readStockVersion(): Promise<string>;
};

export type BackupOnlineOrdersReader = BackupTableReader & {
  readReferenceSequence(): Promise<{ lastValue: string; isCalled: boolean }>;
};

export type BackupReferenceReader = BackupTableReader & {
  readReferenceSequence(): Promise<{ lastValue: string; isCalled: boolean }>;
};

export type BackupRestoreGenerationReader = {
  readRestoreGeneration(): Promise<number>;
};

export type BackupReaderSet = {
  identity: BackupTableReader;
  catalog: BackupTableReader;
  inventory: BackupInventoryReader;
  receiving: BackupTableReader;
  sales: BackupReferenceReader;
  expenses: BackupTableReader;
  pricing: BackupTableReader;
  returns: BackupReferenceReader;
  corrections: BackupTableReader;
  onlineOrders: BackupOnlineOrdersReader;
  storefrontConfiguration: BackupTableReader;
  openingImport: BackupTableReader;
  analytics: BackupTableReader;
  restore: BackupRestoreGenerationReader;
};

export type BackupSnapshotMetadata = {
  capturedAt: string;
  schemaVersion: string;
  stockVersion: string;
  onlineOrderReferenceSequence: { lastValue: string; isCalled: boolean };
  salesSaleReferenceSequence: { lastValue: string; isCalled: boolean };
  returnsReturnReferenceSequence: { lastValue: string; isCalled: boolean };
  sourceGeneration: number;
};

export type BackupSnapshotTransaction = {
  readers: BackupReaderSet;
  metadata(): Promise<BackupSnapshotMetadata>;
};

export type BackupUnitOfWork = {
  run<T>(work: (transaction: BackupSnapshotTransaction) => Promise<T>): Promise<T>;
};

export type BackupSectionManifest = {
  name: BackupSectionName;
  recordCount: number;
  sha256: string;
  tables: Array<{ name: string; recordCount: number }>;
};

export type BackupManifest = {
  format: "bravos-business-data";
  formatVersion: 1;
  backupId: string;
  createdAt: string;
  schemaVersion: string;
  sourceGeneration: number | null;
  createdByStaffId: string;
  stockVersion: string;
  onlineOrderReferenceSequence: { lastValue: string; isCalled: boolean };
  salesSaleReferenceSequence?: { lastValue: string; isCalled: boolean };
  returnsReturnReferenceSequence?: { lastValue: string; isCalled: boolean };
  identityPolicy: { preservesStableIds: true; preservesForeignKeys: true; regeneratesIds: false };
  idProvenance: {
    source: "database_primary_and_foreign_keys";
    stableIdsPreserved: true;
    foreignKeysPreserved: true;
    idsRegenerated: false;
  };
  sections: BackupSectionManifest[];
  totalRecordCount: number;
  knownUnsynchronizedTills: BackupKnownUnsynchronizedTillDto[];
  includesUnsentBrowserRecords: false;
  imageBinariesIncluded: false;
  imageReferencesPreserved: true;
  excludedData: ["credentials", "sessions", "reset_tokens", "service_secrets", "image_binaries", "unsent_browser_records"];
};

export type BackupData = Record<BackupSectionName, Record<string, Array<Record<string, unknown>>>>;

export type DecodedBackupArchive = { manifest: BackupManifest; data: BackupData };

export type BackupCryptoPort = {
  protect(payload: DecodedBackupArchive, password: string): Promise<Uint8Array>;
  sha256(value: string | Uint8Array): string;
};

export type CreatedBackup = {
  bytes: Uint8Array;
  fileName: string;
  archiveSha256: string;
  manifest: BackupManifest;
  sectionCounts: BackupSectionCounts;
};

export type BackupServices = {
  readiness(auth: VerifiedAuth | null): Promise<BackupReadinessDto>;
  create(auth: VerifiedAuth | null, input: unknown): Promise<CreatedBackup>;
};

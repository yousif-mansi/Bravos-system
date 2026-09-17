import type {
  RestoreAcknowledgementRequest,
  RestorePreviewDto,
  RestoreStateDto,
} from "@bravos/contracts";
import type { CreatedBackup, DecodedBackupArchive } from "@bravos/backup";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";

export type { VerifiedAuth };

export type RestoreActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
};

export type RestoreArchivePort = {
  decode(bytes: Uint8Array, password: string): Promise<DecodedBackupArchive>;
  decodeBase64(value: string): Uint8Array;
  sha256(value: Uint8Array | string): string;
};

export type RestoreBackupPort = {
  create(auth: VerifiedAuth | null, input: unknown): Promise<CreatedBackup>;
};

export type RestoreFeaturePort = {
  readonly tableNames: readonly string[];
  clearRestoreTable(tableName: string): Promise<void>;
  insertRestoreTable(tableName: string, rows: Array<Record<string, unknown>>): Promise<number>;
};

export type RestoreKnownTill = {
  deviceId: string;
  staffId: string;
  latestSnapshotId: string;
  latestSnapshotAt: Date;
  stockVersion: string | null;
  pendingOperationIds: string[];
  synchronizationComplete: boolean;
  restoreGeneration: number;
};

export type RestoreInventoryFeaturePort = RestoreFeaturePort & {
  listKnownTillsForRestore(): Promise<RestoreKnownTill[]>;
  assignRestoreGeneration(generation: number): Promise<void>;
};

export type RestoreSalesFeaturePort = RestoreFeaturePort & {
  listRestoreCustodyProofs(operationIds: string[]): Promise<Array<{
    operationId: string;
    saleId: string;
    contentDigest: string;
    custody: "applied" | "deferred";
  }>>;
};

export type RestoreOnlineOrdersFeaturePort = RestoreFeaturePort & {
  restoreReferenceSequence(sequence: { lastValue: string; isCalled: boolean }): Promise<void>;
};

export type RestoreFeatureSet = {
  identity: RestoreFeaturePort;
  catalog: RestoreFeaturePort;
  sales: RestoreSalesFeaturePort;
  inventory: RestoreInventoryFeaturePort;
  receiving: RestoreFeaturePort;
  pricing: RestoreFeaturePort;
  expenses: RestoreFeaturePort;
  onlineOrders: RestoreOnlineOrdersFeaturePort;
  storefrontConfiguration: RestoreFeaturePort;
  returns: RestoreFeaturePort;
  corrections: RestoreFeaturePort;
  openingImport: RestoreFeaturePort;
  analytics: RestoreFeaturePort;
};

export type RestoreStore = {
  state(): Promise<RestoreStateDto>;
  list(): Promise<RestorePreviewDto[]>;
  get(id: string): Promise<RestorePreviewDto | null>;
  stageAndPause(input: {
    id: string;
    operationId: string;
    payloadFingerprint: string;
    archiveSha256: string;
    archive: DecodedBackupArchive;
    actorStaffId: string;
    at: Date;
  }): Promise<{ value: RestorePreviewDto; created: boolean }>;
  attachPreRestoreBackup(input: {
    previewId: string;
    backup: CreatedBackup;
    liveArchive: DecodedBackupArchive;
  }): Promise<RestorePreviewDto>;
  acknowledge(input: RestoreAcknowledgementRequest & {
    previewId: string;
    actorStaffId: string;
  }): Promise<RestorePreviewDto>;
  cancel(input: { previewId: string; actorStaffId: string }): Promise<RestorePreviewDto>;
  readPreRestoreBackup(previewId: string): Promise<{ bytes: Uint8Array; archiveSha256: string; fileName: string }>;
  acknowledgePreRestoreBackup(input: {
    previewId: string;
    archiveSha256: string;
    actorStaffId: string;
  }): Promise<RestorePreviewDto>;
  activate(input: {
    id: string;
    operationId: string;
    payloadFingerprint: string;
    previewId: string;
    previewFingerprint: string;
    actorStaffId: string;
    at: Date;
  }): Promise<{ value: RestorePreviewDto; created: boolean }>;
};

export type RestoreServices = {
  // Checked before a large archive upload body is read.
  authorizeManager(auth: VerifiedAuth | null): Promise<void>;
  state(auth: VerifiedAuth | null): Promise<RestoreStateDto>;
  // Any signed-in staff member can see whether business writes are paused, without preview details.
  pause(auth: VerifiedAuth | null): Promise<RestoreStateDto>;
  list(auth: VerifiedAuth | null): Promise<RestorePreviewDto[]>;
  get(auth: VerifiedAuth | null, previewId: string): Promise<RestorePreviewDto>;
  createPreview(auth: VerifiedAuth | null, input: unknown): Promise<{ value: RestorePreviewDto; created: boolean }>;
  acknowledge(auth: VerifiedAuth | null, previewId: string, input: unknown): Promise<RestorePreviewDto>;
  cancel(auth: VerifiedAuth | null, previewId: string): Promise<RestorePreviewDto>;
  downloadPreRestoreBackup(
    auth: VerifiedAuth | null,
    previewId: string,
  ): Promise<{ bytes: Uint8Array; archiveSha256: string; fileName: string }>;
  acknowledgePreRestoreBackup(auth: VerifiedAuth | null, previewId: string, input: unknown): Promise<RestorePreviewDto>;
  activate(auth: VerifiedAuth | null, previewId: string, input: unknown): Promise<{ value: RestorePreviewDto; created: boolean }>;
};

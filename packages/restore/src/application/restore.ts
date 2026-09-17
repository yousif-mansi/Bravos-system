import type {
  RestoreAcknowledgementRequest,
  RestoreConfirmRequest,
  RestorePreviewRequest,
} from "@bravos/contracts";
import type { DecodedBackupArchive } from "@bravos/backup";
import { ForbiddenError, UnauthenticatedError, isManager } from "@bravos/identity";
import { RestoreValidationError } from "../domain/errors.ts";
import type {
  RestoreActorPort,
  RestoreArchivePort,
  RestoreBackupPort,
  RestoreServices,
  RestoreStore,
  VerifiedAuth,
} from "./ports.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const LEGACY_SCHEMA_VERSION = "028_aggregate_analytics.sql";

export function createRestoreServices(deps: {
  actors: RestoreActorPort;
  archive: RestoreArchivePort;
  backup: RestoreBackupPort;
  store: RestoreStore;
  clock?: { now(): Date };
  ids?: { randomUuid(): string };
}): RestoreServices {
  const now = deps.clock?.now ?? (() => new Date());
  const randomUuid = deps.ids?.randomUuid ?? (() => crypto.randomUUID());
  return {
    async authorizeManager(auth) {
      await requireManager(auth, deps.actors);
    },
    async state(auth) {
      await requireManager(auth, deps.actors);
      return deps.store.state();
    },
    async pause(auth) {
      await requireStaff(auth, deps.actors);
      return deps.store.state();
    },
    async list(auth) {
      await requireManager(auth, deps.actors);
      return deps.store.list();
    },
    async get(auth, previewId) {
      await requireManager(auth, deps.actors);
      const value = await deps.store.get(assertUuid(previewId));
      if (!value) throw new RestoreValidationError("معاينة الاستعادة غير موجودة.");
      return value;
    },
    async createPreview(auth, unknownInput) {
      const actor = await requireManager(auth, deps.actors);
      const input = previewRequest(unknownInput);
      if (input.archiveBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.archiveBase64)) invalid();
      const bytes = deps.archive.decodeBase64(input.archiveBase64);
      // Wrong passwords and damaged files fail here, before any pause or staging database exists.
      const archive = prepareArchive(await decodeUploaded(deps.archive, bytes, input.archivePassword));
      const archiveSha256 = deps.archive.sha256(bytes);
      const staged = await deps.store.stageAndPause({
        id: randomUuid(),
        operationId: input.operationId,
        payloadFingerprint: deps.archive.sha256(JSON.stringify({
          operationId: input.operationId,
          archiveSha256,
          actorStaffId: actor.id,
        })),
        archiveSha256,
        archive,
        actorStaffId: actor.id,
        at: now(),
      });
      // Only the request that created the preview attaches its pre-restore checkpoint.
      if (!staged.created) return staged;
      try {
        const backup = await deps.backup.create(auth, { password: input.preRestoreBackupPassword });
        const liveArchive = await deps.archive.decode(backup.bytes, input.preRestoreBackupPassword);
        return {
          value: await deps.store.attachPreRestoreBackup({ previewId: staged.value.id, backup, liveArchive }),
          created: true,
        };
      } catch (error) {
        try {
          await deps.store.cancel({ previewId: staged.value.id, actorStaffId: actor.id });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "Restore preview failed and resuming business writes did not complete.");
        }
        throw error;
      }
    },
    async acknowledge(auth, previewId, unknownInput) {
      const actor = await requireStaff(auth, deps.actors);
      return deps.store.acknowledge({
        previewId: assertUuid(previewId),
        actorStaffId: actor.id,
        ...acknowledgementRequest(unknownInput),
      });
    },
    async cancel(auth, previewId) {
      const actor = await requireManager(auth, deps.actors);
      return deps.store.cancel({ previewId: assertUuid(previewId), actorStaffId: actor.id });
    },
    async downloadPreRestoreBackup(auth, previewId) {
      await requireManager(auth, deps.actors);
      return deps.store.readPreRestoreBackup(assertUuid(previewId));
    },
    async acknowledgePreRestoreBackup(auth, previewId, unknownInput) {
      const actor = await requireManager(auth, deps.actors);
      const body = record(unknownInput);
      exactKeys(body, ["archiveSha256"]);
      if (typeof body.archiveSha256 !== "string" || !SHA256.test(body.archiveSha256)) invalid();
      return deps.store.acknowledgePreRestoreBackup({
        previewId: assertUuid(previewId),
        archiveSha256: body.archiveSha256.toLowerCase(),
        actorStaffId: actor.id,
      });
    },
    async activate(auth, previewId, unknownInput) {
      const actor = await requireManager(auth, deps.actors);
      const id = assertUuid(previewId);
      const input = confirmRequest(unknownInput);
      return deps.store.activate({
        id: randomUuid(),
        operationId: input.operationId,
        payloadFingerprint: deps.archive.sha256(JSON.stringify({
          target: "restore-activation",
          previewId: id,
          operationId: input.operationId,
          previewFingerprint: input.previewFingerprint,
          actorStaffId: actor.id,
        })),
        previewId: id,
        previewFingerprint: input.previewFingerprint,
        actorStaffId: actor.id,
        at: now(),
      });
    },
  };
}

async function decodeUploaded(archive: RestoreArchivePort, bytes: Uint8Array, password: string) {
  try {
    return await archive.decode(bytes, password);
  } catch (error) {
    throw new RestoreValidationError("تعذر فتح النسخة. تحقق من كلمة المرور وسلامة الملف.", { cause: error });
  }
}

// A version 1 archive made before restore generations existed carries no generation columns
// and no retained-sale table. After authenticated decoding it is staged as generation zero.
function prepareArchive(archive: DecodedBackupArchive): DecodedBackupArchive {
  if (archive.manifest.schemaVersion !== LEGACY_SCHEMA_VERSION) return archive;
  const data = structuredClone(archive.data);
  data.sales.sales_restore_deferred_completion = [];
  data.sales.sales_pos_snapshot = (data.sales.sales_pos_snapshot ?? []).map((row) => ({ ...row, restore_generation: "0" }));
  data.sales.sales_sale = (data.sales.sales_sale ?? []).map((row) => ({ ...row, source_restore_generation: "0" }));
  return { manifest: archive.manifest, data };
}

async function requireStaff(auth: VerifiedAuth | null, actors: RestoreActorPort) {
  if (!auth) throw new UnauthenticatedError();
  const actor = await actors.getStaff(auth.staffId);
  if (!actor || actor.disabled) throw new UnauthenticatedError();
  return actor;
}

async function requireManager(auth: VerifiedAuth | null, actors: RestoreActorPort) {
  const actor = await requireStaff(auth, actors);
  if (!isManager(actor)) throw new ForbiddenError();
  return actor;
}

function previewRequest(value: unknown): RestorePreviewRequest {
  const body = record(value);
  exactKeys(body, ["operationId", "archiveBase64", "archivePassword", "preRestoreBackupPassword"]);
  if (typeof body.archiveBase64 !== "string" || body.archiveBase64.length < 16) invalid();
  return {
    operationId: assertUuid(body.operationId),
    archiveBase64: body.archiveBase64,
    archivePassword: password(body.archivePassword),
    preRestoreBackupPassword: password(body.preRestoreBackupPassword),
  };
}

function acknowledgementRequest(value: unknown): RestoreAcknowledgementRequest {
  const body = record(value);
  exactKeys(body, ["deviceId", "snapshotId"]);
  return { deviceId: assertUuid(body.deviceId), snapshotId: assertUuid(body.snapshotId) };
}

function confirmRequest(value: unknown): RestoreConfirmRequest {
  const body = record(value);
  exactKeys(body, ["operationId", "previewFingerprint"]);
  if (typeof body.previewFingerprint !== "string" || !SHA256.test(body.previewFingerprint)) invalid();
  return { operationId: assertUuid(body.operationId), previewFingerprint: body.previewFingerprint.toLowerCase() };
}

function password(value: unknown): string {
  if (typeof value !== "string" || [...value].length < 12 || [...value].length > 128) {
    throw new RestoreValidationError("يجب أن تتكون كلمة مرور النسخة من 12 إلى 128 حرفًا.");
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const expected = new Set(keys);
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !expected.has(key))) invalid();
}

function assertUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) return invalid();
  return value.toLowerCase();
}

function invalid(): never {
  throw new RestoreValidationError();
}

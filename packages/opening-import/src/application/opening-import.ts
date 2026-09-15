import type { OpeningImportAcceptRequest, OpeningImportPreviewRequest } from "@bravos/contracts";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "@bravos/identity";
import { buildPlan, inputFingerprint } from "../domain/csv.ts";
import { OpeningImportValidationError } from "../domain/errors.ts";
import { coordinateAcceptance, coordinatePreview } from "./coordinator.ts";
import type { OpeningImportActorPort, OpeningImportServices, OpeningImportStore, VerifiedAuth } from "./ports.ts";

export function createOpeningImportServices(deps: { actors: OpeningImportActorPort; store: OpeningImportStore; clock?: { now(): Date } }): OpeningImportServices {
  const now = deps.clock?.now ?? (() => new Date());
  return {
    async authorizeTemplate(auth) { await requireManager(auth, deps.actors); },
    async preview(auth, unknownInput) {
      const actor = await requireManager(auth, deps.actors);
      const input = previewRequest(unknownInput);
      const fingerprint = inputFingerprint(input.files);
      const plan = buildPlan(input.files, now());
      return coordinatePreview(deps.store, { operationId: input.operationId, inputFingerprint: fingerprint, plan, actorStaffId: actor.id, at: now() });
    },
    async get(auth, id) {
      await requireManager(auth, deps.actors);
      assertUuid(id, "معرّف المعاينة غير صالح.");
      const value = await deps.store.getPreview(id);
      if (!value) throw new NotFoundError("معاينة الاستيراد غير موجودة.");
      return value;
    },
    async accept(auth, id, unknownInput) {
      const actor = await requireManager(auth, deps.actors);
      assertUuid(id, "معرّف المعاينة غير صالح.");
      const input = acceptRequest(unknownInput);
      return coordinateAcceptance(deps.store, { previewId: id, operationId: input.operationId, previewFingerprint: input.previewFingerprint, actorStaffId: actor.id, at: now() });
    },
  };
}

async function requireManager(auth: VerifiedAuth | null, actors: OpeningImportActorPort) {
  if (!auth) throw new UnauthenticatedError();
  const staff = await actors.getStaff(auth.staffId);
  if (!staff || staff.disabled || staff.role !== "manager") throw new ForbiddenError();
  return staff;
}

function previewRequest(value: unknown): OpeningImportPreviewRequest {
  if (!isRecord(value) || typeof value.operationId !== "string" || !isRecord(value.files)
    || typeof value.files.catalog !== "string" || typeof value.files.stock !== "string" || typeof value.files.configuration !== "string") {
    throw new OpeningImportValidationError("بيانات ملفات الاستيراد غير صالحة.");
  }
  assertUuid(value.operationId, "معرّف عملية الاستيراد غير صالح.");
  return { operationId: value.operationId, files: { catalog: value.files.catalog, stock: value.files.stock, configuration: value.files.configuration } };
}
function acceptRequest(value: unknown): OpeningImportAcceptRequest {
  if (!isRecord(value) || typeof value.operationId !== "string" || typeof value.previewFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(value.previewFingerprint)) throw new OpeningImportValidationError("بيانات قبول الاستيراد غير صالحة.");
  assertUuid(value.operationId, "معرّف عملية الاستيراد غير صالح.");
  return { operationId: value.operationId, previewFingerprint: value.previewFingerprint };
}
function assertUuid(value: string, message: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new OpeningImportValidationError(message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

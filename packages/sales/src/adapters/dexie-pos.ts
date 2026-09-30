import type { CompletedOperationProofDto, CouponUsageProofDto, PosPriceSnapshotDto, WorkspaceDto } from "@bravos/contracts";
import { Dexie, type EntityTable, type Transaction } from "dexie";
import { isDeclaredSafeMigration, POS_SCHEMA_VERSION } from "../domain/pos-update.ts";
import { mergeVariantQuantities } from "../domain/discount.ts";
import { SalesValidationError } from "../domain/errors.ts";
import { canonicalOfflineSaleFactsJson } from "../domain/canonical-payload.ts";
import { digestOfflineSale } from "../domain/offline-digest.ts";
import { cashPayment, paymentMatches, validatePayment } from "../domain/payment.ts";
import {
  PosStorageError,
  type CompleteOfflineSaleInput,
  type DeviceStockCache,
  type OfflineAcknowledgement,
  type OfflineCompletedSale,
  type OfflinePendingSale,
  type OfflinePosStore,
  type OfflineSession,
  type OfflineStockEffect,
  type SessionTransition,
} from "../application/offline-ports.ts";

const DB_NAME = "bravos-pos";
const LEGACY_PENDING_PREFIX = "bravos.sales.pending.";

type MetaRow = { key: string; value: string };
type SnapshotRow = { staffId: string; snapshot: PosPriceSnapshotDto };
type LegacyPendingRow = OfflinePendingSale & { saleId: string };

type BravosPosDatabase = Dexie & {
  meta: EntityTable<MetaRow, "key">;
  sessions: EntityTable<OfflineSession, "staffId">;
  snapshots: EntityTable<SnapshotRow, "staffId">;
  sales: EntityTable<OfflineCompletedSale, "id">;
  effects: EntityTable<OfflineStockEffect, "id">;
  pending: EntityTable<OfflinePendingSale, "staffId">;
  legacyPending: EntityTable<LegacyPendingRow, "saleId">;
};

function createDatabase(name: string): BravosPosDatabase {
  const db = new Dexie(name) as BravosPosDatabase;
  db.version(1).stores({
    meta: "key",
    sessions: "staffId",
    snapshots: "staffId",
    sales: "id, staffId, operationId, syncStatus",
    effects: "id, staffId, variantId, operationId",
    pending: "staffId, saleId",
  });
  db.version(2)
    .stores({
      meta: "key",
      sessions: "staffId",
      snapshots: "staffId",
      sales: "id, staffId, operationId, syncStatus",
      effects: "id, staffId, variantId, operationId",
      pending: "staffId, saleId",
      legacyPending: "saleId, staffId",
    })
    .upgrade(async (tx) => {
      await tx.table("meta").put({ key: "schemaVersion", value: "2" });
    });
  db.version(3)
    .stores({
      meta: "key",
      sessions: "staffId",
      snapshots: "staffId",
      sales: "id, staffId, operationId, syncStatus",
      effects: "id, staffId, variantId, operationId",
      pending: "staffId, saleId",
      legacyPending: "saleId, staffId",
    })
    .upgrade(async (tx) => {
      await upgradePosRecordsToV3(tx);
    });
  db.version(4)
    .stores({
      meta: "key",
      sessions: "staffId",
      snapshots: "staffId",
      sales: "id, staffId, operationId, syncStatus",
      effects: "id, staffId, variantId, operationId",
      pending: "staffId, saleId",
      legacyPending: "saleId, staffId",
    })
    .upgrade(async (tx) => {
      // A prior upgrade may have quarantined a completed sale whose paid-unit
      // facts cannot be reconstructed. Keep that decision and every raw row.
      if ((await tx.table("meta").get("upgradeBlocked"))?.value) return;
      const sales = await tx.table("sales").toArray() as OfflineCompletedSale[];
      const byOperation = new Map(sales.map((sale) => [sale.operationId, sale.branch.id]));
      await tx.table("effects").toCollection().modify((effect: OfflineStockEffect) => {
        const branchId = byOperation.get(effect.operationId);
        if (branchId) effect.branchId = branchId;
      });
      // Central-stock snapshots are not valid branch balances; refresh before another sale.
      await tx.table("snapshots").clear();
      await tx.table("meta").delete("stockCache");
      await tx.table("meta").delete("stockVersion");
      await tx.table("meta").put({ key: "schemaVersion", value: "4" });
    });
  return db;
}

type LegacyUnit = {
  unitIndex?: number;
  quantity?: number;
  listedPiasters: number;
  discountPiasters: number;
  paidPiasters: number;
};

function tryNormalizeLineUnits(
  line: { quantity: number; units: LegacyUnit[] },
): OfflineCompletedSale["lines"][number]["units"] | null {
  const units = Array.isArray(line.units) ? line.units : [];
  if (
    units.length > 0 &&
    units.every(
      (unit) =>
        Number.isInteger(unit.quantity) &&
        (unit.quantity ?? 0) > 0 &&
        Number.isInteger(unit.unitIndex) &&
        (unit.unitIndex ?? 0) >= 0,
    )
  ) {
    const total = units.reduce((sum, unit) => sum + (unit.quantity ?? 0), 0);
    if (total !== line.quantity) {
      return null;
    }
    return units.map((unit) => ({
      unitIndex: unit.unitIndex ?? 0,
      quantity: unit.quantity ?? 1,
      listedPiasters: unit.listedPiasters,
      discountPiasters: unit.discountPiasters,
      paidPiasters: unit.paidPiasters,
    }));
  }
  if (units.length === line.quantity) {
    return units.map((unit, unitIndex) => ({
      unitIndex,
      quantity: 1,
      listedPiasters: unit.listedPiasters,
      discountPiasters: unit.discountPiasters,
      paidPiasters: unit.paidPiasters,
    }));
  }
  return null;
}

function normalizeCompletedSale(sale: OfflineCompletedSale): OfflineCompletedSale {
  const { restoreGeneration, ...recorded } = sale;
  return {
    ...recorded,
    // A connected sale may not know its restore generation; the server then uses the current one.
    ...(typeof restoreGeneration === "number" && Number.isSafeInteger(restoreGeneration) && restoreGeneration >= 0
      ? { restoreGeneration }
      : {}),
    pricingVersion: sale.pricingVersion === 1 ? 1 : null,
    pricingOccurredAt:
      typeof sale.pricingOccurredAt === "string" ? sale.pricingOccurredAt : null,
    automaticOfferDiscountPiasters: sale.automaticOfferDiscountPiasters ?? 0,
    appliedAutomaticOffer: sale.appliedAutomaticOffer ?? null,
    couponCode: sale.couponCode ?? sale.appliedCoupon?.code ?? null,
    couponDiscountPiasters: sale.couponDiscountPiasters ?? 0,
    appliedCoupon: sale.appliedCoupon ?? null,
    couponUsageAccountedSnapshotIssuedAt:
      typeof sale.couponUsageAccountedSnapshotIssuedAt === "string"
        ? sale.couponUsageAccountedSnapshotIssuedAt
        : null,
    payloadFingerprint:
      typeof sale.payloadFingerprint === "string" && /^[0-9a-f]{64}$/i.test(sale.payloadFingerprint)
        ? sale.payloadFingerprint.toLowerCase()
        : null,
    lines: sale.lines.map((line) => {
      const units = tryNormalizeLineUnits(line);
      return units ? { ...line, units } : line;
    }),
  };
}

function completedLineUnitsUnsafe(line: { quantity: number; units?: LegacyUnit[] }): boolean {
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    return false;
  }
  return tryNormalizeLineUnits({ quantity: line.quantity, units: line.units ?? [] }) === null;
}

function quoteLinesUnsafe(
  quote: { lines?: Array<{ quantity: number; units?: LegacyUnit[] }> } | null | undefined,
  requirePaidUnits: boolean,
): boolean {
  if (!quote?.lines) {
    return false;
  }
  return quote.lines.some((line) => {
    if (!requirePaidUnits && (line.units?.length ?? 0) === 0) {
      return false;
    }
    return completedLineUnitsUnsafe({ quantity: line.quantity, units: line.units ?? [] });
  });
}

function inspectUpgradeSafety(
  sales: OfflineCompletedSale[],
  pendingRows: OfflinePendingSale[],
  sessions: OfflineSession[],
  currentStaffId: string | undefined,
): { safe: boolean; currentStaffId?: string } {
  for (const sale of sales) {
    for (const line of sale.lines) {
      if (completedLineUnitsUnsafe(line)) {
        return { safe: false };
      }
    }
  }
  for (const row of pendingRows) {
    if (quoteLinesUnsafe(row.quote, row.physicallyCompleted === true)) {
      return { safe: false };
    }
  }
  const signedIn = sessions.filter((row) => !row.signedOut);
  if (!currentStaffId && signedIn.length > 1) {
    return { safe: false };
  }
  const inferred = currentStaffId ?? signedIn[0]?.staffId;
  return inferred ? { safe: true, currentStaffId: inferred } : { safe: true };
}

async function upgradePosRecordsToV3(tx: Transaction) {
  const sales = (await tx.table("sales").toArray()) as OfflineCompletedSale[];
  const pendingRows = [
    ...((await tx.table("pending").toArray()) as OfflinePendingSale[]),
    ...((await tx.table("legacyPending").toArray()) as OfflinePendingSale[]),
  ];
  const sessions = (await tx.table("sessions").toArray()) as OfflineSession[];
  const existing = (await tx.table("meta").get("currentStaffId")) as MetaRow | undefined;
  const inspection = inspectUpgradeSafety(sales, pendingRows, sessions, existing?.value);
  if (!inspection.safe) {
    await tx.table("meta").put({ key: "schemaVersion", value: "2" });
    await tx.table("meta").put({ key: "upgradeBlocked", value: "1" });
    return;
  }
  for (const sale of sales) {
    await tx.table("sales").put(normalizeCompletedSale(sale));
  }
  async function normalizePendingQuote(row: OfflinePendingSale): Promise<OfflinePendingSale> {
    if (!row.quote) {
      return row;
    }
    return {
      ...row,
      quote: {
        ...row.quote,
        lines: row.quote.lines.map((line) => {
          const units = tryNormalizeLineUnits({ quantity: line.quantity, units: line.units ?? [] });
          return units ? { ...line, units } : line;
        }),
      },
    };
  }
  for (const row of (await tx.table("pending").toArray()) as OfflinePendingSale[]) {
    await tx.table("pending").put(await normalizePendingQuote(row));
  }
  for (const row of (await tx.table("legacyPending").toArray()) as OfflinePendingSale[]) {
    await tx.table("legacyPending").put(await normalizePendingQuote(row));
  }
  if (inspection.currentStaffId) {
    await tx.table("meta").put({ key: "currentStaffId", value: inspection.currentStaffId });
  }
  await tx.table("meta").delete("upgradeBlocked");
  await tx.table("meta").put({ key: "schemaVersion", value: String(POS_SCHEMA_VERSION) });
}

async function storedSessionRevision(db: BravosPosDatabase): Promise<string | null> {
  return (await db.meta.get("sessionRevision"))?.value ?? null;
}

async function writeIfCurrentRevision(
  db: BravosPosDatabase,
  transition: SessionTransition | undefined,
  work: () => Promise<void>,
) {
  const stored = await storedSessionRevision(db);
  if (transition && stored !== transition.expectedRevision) {
    return false;
  }
  await work();
  if (transition) {
    await db.meta.put({ key: "sessionRevision", value: transition.revision });
  }
  return true;
}

function emptyStockCache(): DeviceStockCache {
  return { version: 0, restoreGeneration: 0, availability: {}, includedOperationIds: [] };
}

async function readStockCacheRecord(db: BravosPosDatabase): Promise<DeviceStockCache> {
  const stored = await db.meta.get("stockCache");
  if (!stored?.value) {
    const version = await readAppliedStockVersion(db);
    return { version, restoreGeneration: 0, availability: {}, includedOperationIds: [] };
  }
  try {
    const parsed = JSON.parse(stored.value) as DeviceStockCache;
    if (!parsed || typeof parsed !== "object" || !Number.isSafeInteger(parsed.version) || parsed.version < 0) {
      return emptyStockCache();
    }
    return {
      version: parsed.version,
      branchVersions: parsed.branchVersions && typeof parsed.branchVersions === "object" ? parsed.branchVersions : {},
      restoreGeneration:
        Number.isSafeInteger(parsed.restoreGeneration) && (parsed.restoreGeneration ?? -1) >= 0
          ? parsed.restoreGeneration
          : 0,
      availability: parsed.availability && typeof parsed.availability === "object" ? parsed.availability : {},
      includedOperationIds: Array.isArray(parsed.includedOperationIds)
        ? parsed.includedOperationIds.filter((id) => typeof id === "string")
        : [],
    };
  } catch {
    return emptyStockCache();
  }
}

async function writeStockCacheRecord(db: BravosPosDatabase, cache: DeviceStockCache) {
  await db.meta.put({ key: "stockCache", value: JSON.stringify(cache) });
  await db.meta.put({ key: "stockVersion", value: String(cache.version) });
}

async function readAppliedStockVersion(db: BravosPosDatabase): Promise<number> {
  const cache = await db.meta.get("stockCache");
  if (cache?.value) {
    try {
      const parsed = JSON.parse(cache.value) as { version?: number };
      if (Number.isSafeInteger(parsed.version) && (parsed.version ?? 0) >= 0) {
        return parsed.version ?? 0;
      }
    } catch {
      /* fall through */
    }
  }
  const stored = await db.meta.get("stockVersion");
  const parsed = stored?.value ? Number(stored.value) : 0;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function overlaySnapshot(snapshot: PosPriceSnapshotDto, cache: DeviceStockCache): PosPriceSnapshotDto {
  return {
    ...snapshot,
    restoreGeneration:
      Number.isSafeInteger(snapshot.restoreGeneration) && snapshot.restoreGeneration >= 0
        ? snapshot.restoreGeneration
        : cache.restoreGeneration,
    stockVersion: cache.branchVersions?.[snapshot.branch.id] ?? cache.version,
    includedOperationIds: cache.includedOperationIds,
    includedOperations: [],
    products: snapshot.products.map((product) => ({
      ...product,
      variants: product.variants.map((variant) => ({
        ...variant,
        availableQuantity:
          stockKey(snapshot.branch.id, variant.id) in cache.availability
            ? cache.availability[stockKey(snapshot.branch.id, variant.id)] ?? 0
            : variant.availableQuantity,
      })),
    })),
  };
}

async function overlayAllSnapshots(db: BravosPosDatabase, cache: DeviceStockCache) {
  const snapshots = await db.snapshots.toArray();
  for (const row of snapshots) {
    await db.snapshots.put({
      staffId: row.staffId,
      snapshot: overlaySnapshot(row.snapshot, cache),
    });
  }
}

type PreparedLocalDigest = {
  digest: string;
  canonical: string;
};

function saleFacts(local: OfflineCompletedSale) {
  return {
    id: local.id,
    kind: local.kind,
    snapshotId: local.snapshotId,
    pricingVersion: local.pricingVersion ?? null,
    occurredAt: local.occurredAt,
    ...(local.pricingOccurredAt ? { pricingOccurredAt: local.pricingOccurredAt } : {}),
    customerName: local.customerName,
    customerPhone: local.customerPhone,
    couponCode: local.couponCode,
    employeeDiscountPiasters: local.employeeDiscountPiasters,
    discountReason: local.discountReason,
    ...(local.payment ? { payment: local.payment } : {}),
    lines: local.lines,
  };
}

async function prepareLocalDigests(
  db: BravosPosDatabase,
  proofs: Array<{ operationId: string }>,
): Promise<Map<string, PreparedLocalDigest>> {
  const prepared = new Map<string, PreparedLocalDigest>();
  const operationIds = [
    ...new Set(proofs.map((proof) => proof.operationId).filter((id) => typeof id === "string")),
  ];
  for (const operationId of operationIds) {
    const locals = await db.sales.where("operationId").equals(operationId).toArray();
    for (const local of locals) {
      const canonical = canonicalOfflineSaleFactsJson(saleFacts(local));
      const digest = await digestOfflineSale({ ...saleFacts(local), payloadFingerprint: null });
      prepared.set(local.id, { digest, canonical });
    }
  }
  return prepared;
}

function localMatchesProof(
  local: OfflineCompletedSale,
  proof: CompletedOperationProofDto,
  contentDigest: string,
): boolean {
  if (local.id !== proof.saleId || local.operationId !== proof.operationId) {
    return false;
  }
  if (typeof proof.contentDigest !== "string" || !/^[0-9a-f]{64}$/i.test(proof.contentDigest)) {
    return false;
  }
  if (typeof contentDigest !== "string" || !/^[0-9a-f]{64}$/i.test(contentDigest)) {
    return false;
  }
  return contentDigest.toLowerCase() === proof.contentDigest.toLowerCase();
}

function stockKey(branchId: string, variantId: string): string {
  return `${branchId}:${variantId}`;
}

async function remainingKnownStock(db: BravosPosDatabase, branchId: string, variantId: string, pinned: number): Promise<number> {
  const cache = await readStockCacheRecord(db);
  const included = new Set(cache.includedOperationIds);
  const key = stockKey(branchId, variantId);
  const base = Object.prototype.hasOwnProperty.call(cache.availability, key)
    ? cache.availability[key] ?? 0
    : pinned;
  const outstanding = await db.effects.where("variantId").equals(variantId).toArray();
  const used = outstanding
    .filter((effect) => effect.branchId === branchId && !included.has(effect.operationId))
    .reduce((sum, effect) => sum + effect.quantity, 0);
  return base - used;
}

async function acknowledgeMatchingOperations(
  db: BravosPosDatabase,
  proofs: CompletedOperationProofDto[],
  sales: OfflineAcknowledgement["sales"],
  prepared: Map<string, PreparedLocalDigest>,
): Promise<string[]> {
  const byId = new Map((sales ?? []).map((sale) => [sale.id, sale]));
  const acked: string[] = [];
  for (const proof of proofs) {
    if (typeof proof.operationId !== "string" || typeof proof.saleId !== "string") {
      continue;
    }
    const locals = await db.sales.where("operationId").equals(proof.operationId).toArray();
    if (locals.length === 0) {
      continue;
    }
    for (const local of locals) {
      const known = prepared.get(local.id);
      if (!known) {
        continue;
      }
      if (canonicalOfflineSaleFactsJson(saleFacts(local)) !== known.canonical) {
        continue;
      }
      const digest = known.digest;
      if (!localMatchesProof(local, proof, digest)) {
        continue;
      }
      const remote = byId.get(local.id);
      const next: OfflineCompletedSale = {
        ...local,
        payloadFingerprint: digest,
        syncStatus: "acknowledged",
        recordedAt: remote?.recordedAt ?? local.recordedAt,
        lines: local.lines.map((line) => {
          const remoteLine =
            remote?.lines.find((item) => item.id === line.id) ??
            remote?.lines.find((item) => item.variantId === line.variantId);
          if (!remoteLine) {
            return line;
          }
          return {
            ...line,
            allocatedQuantity: remoteLine.allocatedQuantity,
            unallocatedQuantity: remoteLine.unallocatedQuantity,
          };
        }),
      };
      await db.sales.put(normalizeCompletedSale(next));
      await db.effects.where("operationId").equals(local.operationId).delete();
      acked.push(local.operationId);
    }
  }
  return [...new Set(acked)];
}

async function validateDeferredCustodyProofs(
  db: BravosPosDatabase,
  proofs: CompletedOperationProofDto[],
  prepared: Map<string, PreparedLocalDigest>,
) {
  for (const proof of proofs) {
    const locals = await db.sales.where("operationId").equals(proof.operationId).toArray();
    if (locals.length !== 1) throw new SalesValidationError("تعذر التحقق من حفظ البيع المتأخر لدى الخادم.");
    const matched = locals.some((local) => {
      const known = prepared.get(local.id);
      return Boolean(
        known
        && canonicalOfflineSaleFactsJson(saleFacts(local)) === known.canonical
        && localMatchesProof(local, proof, known.digest),
      );
    });
    if (!matched) throw new SalesValidationError("تعذر التحقق من حفظ البيع المتأخر لدى الخادم.");
  }
}

async function applyAcknowledgementRecord(
  db: BravosPosDatabase,
  input: OfflineAcknowledgement,
  prepared: Map<string, PreparedLocalDigest>,
) {
  if (!Number.isSafeInteger(input.stockVersion) || input.stockVersion < 0) {
    throw new SalesValidationError("تعذر تأكيد المزامنة.");
  }
  const proofs = Array.isArray(input.includedOperations) ? input.includedOperations : [];
  const cache = await readStockCacheRecord(db);
  const proofSaleId = input.sales?.[0]?.id ?? proofs[0]?.saleId;
  const proofSale = proofSaleId ? await db.sales.get(proofSaleId) : null;
  const branchId = input.branchId ?? proofSale?.branch.id;
  if (!branchId) throw new SalesValidationError("فرع المزامنة غير معروف.");
  const branchVersion = cache.branchVersions?.[branchId] ?? 0;
  const acked = await acknowledgeMatchingOperations(db, proofs, input.sales, prepared);
  if (input.stockVersion < branchVersion) {
    const next = {
      ...cache,
      includedOperationIds: [...new Set([...cache.includedOperationIds, ...acked])],
    };
    await writeStockCacheRecord(db, next);
    await overlayAllSnapshots(db, next);
    return;
  }
  const availability = { ...cache.availability };
  if (input.stockVersion > branchVersion) {
    for (const item of input.availability) {
      availability[stockKey(branchId, item.variantId)] = item.availableQuantity;
    }
  } else {
    for (const item of input.availability) {
      const key = stockKey(branchId, item.variantId);
      if (!(key in availability)) {
        availability[key] = item.availableQuantity;
      }
    }
  }
  const next: DeviceStockCache = {
    version: Math.max(input.stockVersion, cache.version),
    branchVersions: { ...cache.branchVersions, [branchId]: Math.max(input.stockVersion, branchVersion) },
    restoreGeneration: cache.restoreGeneration,
    availability,
    includedOperationIds: [...new Set([...cache.includedOperationIds, ...acked])],
  };
  await writeStockCacheRecord(db, next);
  await overlayAllSnapshots(db, next);
}

function canonicalLines(lines: Array<{ variantId: string; quantity: number }>) {
  return mergeVariantQuantities(lines);
}

function sameCompletedReplay(existing: OfflineCompletedSale, input: CompleteOfflineSaleInput): boolean {
  if (existing.operationId !== input.operationId || existing.staffId !== input.staffId) {
    return false;
  }
  if (existing.kind !== input.kind) {
    return false;
  }
  const expectedSnapshotId = input.kind === "accepted" ? input.snapshot.snapshotId : null;
  if ((existing.snapshotId ?? null) !== expectedSnapshotId) {
    return false;
  }
  const expectedPricingVersion = input.kind === "accepted" && input.snapshot.pricingVersion === 1 ? 1 : null;
  if ((existing.pricingVersion ?? null) !== expectedPricingVersion) {
    return false;
  }
  if ((existing.restoreGeneration ?? 0) !== (input.snapshot.restoreGeneration ?? 0)) {
    return false;
  }
  if (expectedPricingVersion === 1 && existing.occurredAt !== input.occurredAt) {
    return false;
  }
  if (
    expectedPricingVersion === 1 &&
    (existing.pricingOccurredAt ?? null) !== (input.pricingOccurredAt ?? null)
  ) {
    return false;
  }
  if (existing.branch.id !== input.branch.id) {
    return false;
  }
  if (existing.customerName !== input.customerName || existing.customerPhone !== input.customerPhone) {
    return false;
  }
  if ((existing.couponCode ?? null) !== (input.couponCode ?? null)) return false;
  if (existing.employeeDiscountPiasters !== input.employeeDiscountPiasters) {
    return false;
  }
  if (existing.discountReason !== input.discountReason) {
    return false;
  }
  if (!paymentMatches(existing.payment ?? cashPayment(existing.finalTotalPiasters),
    validatePayment(input.payment, existing.finalTotalPiasters))) return false;
  const left = canonicalLines(existing.lines);
  const right = canonicalLines(input.lines);
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item.variantId === right[index]?.variantId && item.quantity === right[index]?.quantity);
}

function sameRecordedReplay(existing: OfflineCompletedSale, incoming: OfflineCompletedSale): boolean {
  if (existing.operationId !== incoming.operationId || existing.staffId !== incoming.staffId) {
    return false;
  }
  if (existing.kind !== incoming.kind || (existing.snapshotId ?? null) !== (incoming.snapshotId ?? null)) {
    return false;
  }
  if ((existing.pricingVersion ?? null) !== (incoming.pricingVersion ?? null)) {
    return false;
  }
  if ((existing.restoreGeneration ?? 0) !== (incoming.restoreGeneration ?? 0)) {
    return false;
  }
  if (incoming.pricingVersion === 1 && existing.occurredAt !== incoming.occurredAt) {
    return false;
  }
  if (
    incoming.pricingVersion === 1 &&
    (existing.pricingOccurredAt ?? null) !== (incoming.pricingOccurredAt ?? null)
  ) {
    return false;
  }
  if (existing.branch.id !== incoming.branch.id) {
    return false;
  }
  if (existing.originalTotalPiasters !== incoming.originalTotalPiasters) {
    return false;
  }
  if (
    existing.automaticOfferDiscountPiasters !== incoming.automaticOfferDiscountPiasters ||
    existing.couponDiscountPiasters !== incoming.couponDiscountPiasters ||
    (existing.appliedAutomaticOffer?.id ?? null) !== (incoming.appliedAutomaticOffer?.id ?? null) ||
    (existing.appliedCoupon?.id ?? null) !== (incoming.appliedCoupon?.id ?? null)
  ) {
    return false;
  }
  if (existing.employeeDiscountPiasters !== incoming.employeeDiscountPiasters) {
    return false;
  }
  if (existing.finalTotalPiasters !== incoming.finalTotalPiasters) {
    return false;
  }
  if (!paymentMatches(existing.payment ?? cashPayment(existing.finalTotalPiasters),
    incoming.payment ?? cashPayment(incoming.finalTotalPiasters))) return false;
  const left = canonicalLines(existing.lines);
  const right = canonicalLines(incoming.lines);
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item.variantId === right[index]?.variantId && item.quantity === right[index]?.quantity);
}

async function currentSignedIn(db: BravosPosDatabase) {
  const currentId = (await db.meta.get("currentStaffId"))?.value;
  if (currentId) {
    const row = await db.sessions.get(currentId);
    if (row && !row.signedOut) {
      return row;
    }
  }
  const signedIn = (await db.sessions.toArray()).filter((row) => !row.signedOut);
  if (signedIn.length === 1) {
    return signedIn[0];
  }
  return null;
}

async function matchesCurrentActor(db: BravosPosDatabase, staffId: string): Promise<boolean> {
  const current = await currentSignedIn(db);
  return Boolean(current && current.staffId === staffId);
}

async function assertCurrentActor(db: BravosPosDatabase, staffId: string) {
  if (!(await matchesCurrentActor(db, staffId))) {
    throw new SalesValidationError("تعذر حفظ البيع محلياً.");
  }
}

function toPendingRecord(parsed: OfflinePendingSale): OfflinePendingSale {
  const payload = parsed.payload
    ? { ...parsed.payload, couponCode: parsed.payload.couponCode ?? null }
    : null;
  const quote = parsed.quote
    ? {
        ...parsed.quote,
        couponDiscountPiasters: parsed.quote.couponDiscountPiasters ?? 0,
        appliedCoupon: parsed.quote.appliedCoupon ?? null,
      }
    : null;
  return {
    staffId: parsed.staffId,
    saleId: parsed.saleId,
    operationId: parsed.operationId,
    phase: parsed.phase === "prepared" || parsed.phase === "rejected" ? parsed.phase : "uncertain",
    physicallyCompleted: parsed.physicallyCompleted === true,
    digest: typeof parsed.digest === "string" ? parsed.digest : null,
    payload,
    occurredAt: typeof parsed.occurredAt === "string" ? parsed.occurredAt : null,
    pricingOccurredAt: typeof parsed.pricingOccurredAt === "string" ? parsed.pricingOccurredAt : null,
    quote,
    snapshot: parsed.snapshot ?? null,
    quoteOrigin: parsed.quoteOrigin === "server" || parsed.quoteOrigin === "snapshot" ? parsed.quoteOrigin : null,
    cachedByVariant: parsed.cachedByVariant ?? null,
  };
}

export function createDexiePosStore(options?: { databaseName?: string }): OfflinePosStore {
  const db = createDatabase(options?.databaseName ?? DB_NAME);

  async function ensureOpen() {
    try {
      if (!db.isOpen()) {
        await db.open();
      }
      const blocked = await db.meta.get("upgradeBlocked");
      const stored = await db.meta.get("schemaVersion");
      if (!blocked?.value && stored?.value !== String(POS_SCHEMA_VERSION)) {
        await db.meta.put({ key: "schemaVersion", value: String(POS_SCHEMA_VERSION) });
      }
    } catch {
      throw new PosStorageError();
    }
  }

  return {
    async deviceId() {
      await ensureOpen();
      try {
        return await db.transaction("rw", db.meta, async () => {
          const existing = await db.meta.get("deviceId");
          if (existing?.value) {
            return existing.value;
          }
          const deviceId = crypto.randomUUID();
          await db.meta.put({ key: "deviceId", value: deviceId });
          return deviceId;
        });
      } catch (error) {
        if (error instanceof PosStorageError) {
          throw error;
        }
        throw new PosStorageError();
      }
    },

    async rememberSession(workspace: WorkspaceDto, transition?: SessionTransition) {
      await ensureOpen();
      return db.transaction("rw", db.sessions, db.meta, async () => {
        return writeIfCurrentRevision(db, transition, async () => {
          await db.sessions.put({
            staffId: workspace.staff.id,
            workspace,
            signedOut: false,
            updatedAt: new Date().toISOString(),
          });
          await db.meta.put({ key: "currentStaffId", value: workspace.staff.id });
        });
      });
    },

    async markSignedOut(staffId: string, transition?: SessionTransition) {
      await ensureOpen();
      return db.transaction("rw", db.sessions, db.meta, async () => {
        return writeIfCurrentRevision(db, transition, async () => {
          const current = await db.sessions.get(staffId);
          if (!current) {
            await db.sessions.put({
              staffId,
              workspace: {
                staff: { id: staffId, loginName: "", displayName: "", role: "employee", disabled: false },
                authorizedBranches: [],
                activeBranch: null,
                capabilities: {
                  cashier: false,
                  orderRepresentative: false,
                  manageStaff: false,
                  manageCatalog: false,
                  manageInventory: false,
                  managePricing: false,
                },
              },
              signedOut: true,
              updatedAt: new Date().toISOString(),
            });
          } else {
            await db.sessions.put({ ...current, signedOut: true, updatedAt: new Date().toISOString() });
          }
          const pointer = await db.meta.get("currentStaffId");
          if (pointer?.value === staffId) {
            await db.meta.delete("currentStaffId");
          }
        });
      });
    },

    async readSessionRevision() {
      await ensureOpen();
      return storedSessionRevision(db);
    },

    async canUpgradeSafely(incomingSchemaVersion: number) {
      await ensureOpen();
      const blocked = await db.meta.get("upgradeBlocked");
      if (blocked?.value) {
        return false;
      }
      const stored = await this.readSchemaVersion();
      if (!isDeclaredSafeMigration(stored, incomingSchemaVersion)) {
        return false;
      }
      if (incomingSchemaVersion <= stored) {
        return true;
      }
      const sales = await db.sales.toArray();
      const pendingRows = [...(await db.pending.toArray()), ...(await db.legacyPending.toArray())];
      const sessions = await db.sessions.toArray();
      const pointer = await db.meta.get("currentStaffId");
      return inspectUpgradeSafety(sales, pendingRows, sessions, pointer?.value).safe;
    },

    async loadSignedInWorkspace() {
      await ensureOpen();
      return (await currentSignedIn(db))?.workspace ?? null;
    },

    async saveSnapshot(staffId, snapshot) {
      await ensureOpen();
      const current = await currentSignedIn(db);
      if (!current || current.staffId !== staffId) {
        return;
      }
      try {
        const incomingProofs = Array.isArray(snapshot.includedOperations) ? snapshot.includedOperations : [];
        const deferredProofs = Array.isArray(snapshot.deferredCompletionProofs) ? snapshot.deferredCompletionProofs : [];
        const couponProofs: CouponUsageProofDto[] = Array.isArray(snapshot.couponAccountedOperations)
          ? snapshot.couponAccountedOperations
          : [];
        const prepared = await prepareLocalDigests(db, incomingProofs);
        const deferredPrepared = await prepareLocalDigests(db, deferredProofs);
        const couponPrepared = await prepareLocalDigests(db, couponProofs);
        await db.transaction("rw", db.snapshots, db.meta, db.sales, db.effects, async () => {
          const priorSnapshot = await db.snapshots.get(staffId);
          await validateDeferredCustodyProofs(db, deferredProofs, deferredPrepared);
          for (const proof of couponProofs) {
            if (proof.sourceType !== "physical_sale") continue;
            const localRows = await db.sales.where("operationId").equals(proof.operationId).toArray();
            for (const local of localRows) {
              const known = couponPrepared.get(local.id);
              if (
                !known ||
                canonicalOfflineSaleFactsJson(saleFacts(local)) !== known.canonical ||
                local.id !== proof.sourceId ||
                local.operationId !== proof.operationId ||
                local.appliedCoupon?.id !== proof.couponId ||
                !/^[0-9a-f]{64}$/i.test(proof.payloadFingerprint) ||
                known.digest.toLowerCase() !== proof.payloadFingerprint.toLowerCase()
              ) {
                continue;
              }
              const priorProofAt = Date.parse(local.couponUsageAccountedSnapshotIssuedAt ?? "");
              const incomingProofAt = Date.parse(snapshot.issuedAt);
              if (!Number.isFinite(priorProofAt) || incomingProofAt >= priorProofAt) {
                await db.sales.put({ ...local, couponUsageAccountedSnapshotIssuedAt: snapshot.issuedAt });
              }
            }
          }
          const cache = await readStockCacheRecord(db);
          const incomingGeneration =
            typeof snapshot.restoreGeneration === "number"
              && Number.isSafeInteger(snapshot.restoreGeneration)
              && snapshot.restoreGeneration >= 0
              ? snapshot.restoreGeneration
              : 0;
          const incomingVersion =
            typeof snapshot.stockVersion === "number" && Number.isSafeInteger(snapshot.stockVersion)
              ? snapshot.stockVersion
              : 0;
          const branchId = snapshot.branch.id;
          const branchVersion = cache.branchVersions?.[branchId] ?? 0;
          let next = cache;
          if (incomingGeneration > cache.restoreGeneration) {
            const availability: Record<string, number> = {};
            for (const product of snapshot.products) {
              for (const variant of product.variants) {
                availability[stockKey(branchId, variant.id)] = variant.availableQuantity;
              }
            }
            const acked = await acknowledgeMatchingOperations(db, incomingProofs, undefined, prepared);
            next = {
              version: incomingVersion,
              branchVersions: { [branchId]: incomingVersion },
              restoreGeneration: incomingGeneration,
              availability,
              includedOperationIds: [...new Set([...snapshot.includedOperationIds, ...acked])],
            };
            await writeStockCacheRecord(db, next);
            await overlayAllSnapshots(db, next);
          } else if (incomingGeneration < cache.restoreGeneration) {
            return;
          } else if (incomingVersion > branchVersion) {
            const availability = { ...cache.availability };
            for (const product of snapshot.products) {
              for (const variant of product.variants) {
                availability[stockKey(branchId, variant.id)] = variant.availableQuantity;
              }
            }
            const acked = await acknowledgeMatchingOperations(db, incomingProofs, undefined, prepared);
            next = {
              version: Math.max(incomingVersion, cache.version),
              branchVersions: { ...cache.branchVersions, [branchId]: incomingVersion },
              restoreGeneration: incomingGeneration,
              availability,
              includedOperationIds: [...new Set([...cache.includedOperationIds, ...acked])],
            };
            await writeStockCacheRecord(db, next);
            await overlayAllSnapshots(db, next);
          } else if (incomingVersion === branchVersion && incomingProofs.length > 0) {
            const acked = await acknowledgeMatchingOperations(db, incomingProofs, undefined, prepared);
            next = {
              ...cache,
              restoreGeneration: incomingGeneration,
              includedOperationIds: [...new Set([...cache.includedOperationIds, ...acked])],
            };
            await writeStockCacheRecord(db, next);
          } else if (incomingVersion < branchVersion && incomingProofs.length > 0) {
            const acked = await acknowledgeMatchingOperations(db, incomingProofs, undefined, prepared);
            next = {
              ...cache,
              restoreGeneration: incomingGeneration,
              includedOperationIds: [...new Set([...cache.includedOperationIds, ...acked])],
            };
            await writeStockCacheRecord(db, next);
          }
          const priorIssuedAt = Date.parse(priorSnapshot?.snapshot.issuedAt ?? "");
          const incomingIssuedAt = Date.parse(snapshot.issuedAt);
          if (!priorSnapshot || !Number.isFinite(priorIssuedAt) || incomingIssuedAt >= priorIssuedAt) {
            await db.snapshots.put({
              staffId,
              snapshot: overlaySnapshot(snapshot, next),
            });
          }
        });
      } catch (error) {
        if (error instanceof PosStorageError || error instanceof SalesValidationError) {
          throw error;
        }
        throw new PosStorageError();
      }
    },

    async loadSnapshot(staffId) {
      await ensureOpen();
      const row = await db.snapshots.get(staffId);
      if (!row) {
        return null;
      }
      return overlaySnapshot(row.snapshot, await readStockCacheRecord(db));
    },

    async lookupProduct(staffId, code) {
      const snapshot = await this.loadSnapshot(staffId);
      if (!snapshot) {
        return null;
      }
      const needle = code.trim();
      return snapshot.products.find((product) => product.code === needle) ?? null;
    },

    async availableQuantity(branchId, variantId, cachedAvailable) {
      await ensureOpen();
      return remainingKnownStock(db, branchId, variantId, cachedAvailable);
    },

    async countUnaccountedCouponUses(couponId, snapshotIssuedAt) {
      await ensureOpen();
      const snapshotTime = Date.parse(snapshotIssuedAt);
      const rows = await db.sales.toArray();
      return rows.filter((sale) => {
        if (sale.appliedCoupon?.id !== couponId) return false;
        const proofTime = Date.parse(sale.couponUsageAccountedSnapshotIssuedAt ?? "");
        return !Number.isFinite(proofTime) || !Number.isFinite(snapshotTime) || proofTime > snapshotTime;
      }).length;
    },

    async completeSale(input: CompleteOfflineSaleInput, priced) {
      await ensureOpen();
      try {
        if (typeof priced.payloadFingerprint !== "string" || !/^[0-9a-f]{64}$/i.test(priced.payloadFingerprint)) {
          throw new SalesValidationError("تعذر حفظ البيع محلياً.");
        }
        const expectedCanonical = canonicalOfflineSaleFactsJson({
          id: input.saleId,
          kind: input.kind,
          snapshotId: input.kind === "accepted" ? input.snapshot.snapshotId : null,
          ...(input.kind === "accepted" && input.snapshot.pricingVersion === 1
            ? {
                pricingVersion: 1 as const,
                occurredAt: input.occurredAt,
                pricingOccurredAt: input.pricingOccurredAt ?? "",
              }
            : {}),
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          couponCode: input.couponCode,
          employeeDiscountPiasters: input.employeeDiscountPiasters,
          discountReason: input.discountReason,
          ...(input.payment ? { payment: input.payment } : {}),
          lines: input.lines.map((line) => ({
            variantId: line.variantId,
            quantity: line.quantity,
            ...(input.kind === "accepted" && input.snapshot.pricingVersion === 1
              ? { listedUnitPricePiasters: line.variant.sellingPricePiasters }
              : {}),
          })),
        });
        return await db.transaction("rw", db.sales, db.effects, db.pending, db.sessions, db.meta, async () => {
          await assertCurrentActor(db, input.staffId);
          const existing = await db.sales.get(input.saleId);
          if (existing) {
            if (!sameCompletedReplay(existing, input)) {
              throw new SalesValidationError("تعذر حفظ البيع محلياً.");
            }
            return normalizeCompletedSale(existing);
          }
          const quantities = mergeVariantQuantities(input.lines);
          for (const item of quantities) {
            const variant = input.lines.find((line) => line.variantId === item.variantId)?.variant;
            const pinned = variant?.availableQuantity ?? 0;
            const remaining = await remainingKnownStock(db, input.branch.id, item.variantId, pinned);
            if (remaining < item.quantity) {
              throw new SalesValidationError("الكمية المتاحة غير كافية.");
            }
          }
          const sale: OfflineCompletedSale = {
            id: input.saleId,
            staffId: input.staffId,
            operationId: input.operationId,
            deviceId: input.deviceId,
            snapshotId: input.kind === "accepted" ? input.snapshot.snapshotId : null,
            pricingVersion: input.kind === "accepted" && input.snapshot.pricingVersion === 1 ? 1 : null,
            restoreGeneration: input.snapshot.restoreGeneration ?? 0,
            pricingOccurredAt: input.pricingOccurredAt ?? null,
            kind: input.kind,
            syncStatus: "pending",
            branch: input.branch,
            soldByStaffId: input.staffId,
            soldByDisplayName: input.soldByDisplayName,
            occurredAt: input.occurredAt,
            recordedAt: null,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            couponCode: input.couponCode,
            originalTotalPiasters: priced.originalTotalPiasters,
            automaticOfferDiscountPiasters: priced.automaticOfferDiscountPiasters,
            appliedAutomaticOffer: priced.appliedAutomaticOffer,
            couponDiscountPiasters: priced.couponDiscountPiasters,
            appliedCoupon: priced.appliedCoupon,
            employeeDiscountPiasters: input.employeeDiscountPiasters,
            discountReason: input.discountReason,
            discountedByStaffId: input.employeeDiscountPiasters > 0 ? input.staffId : null,
            finalTotalPiasters: priced.finalTotalPiasters,
            ...(input.payment ? { payment: validatePayment(input.payment, priced.finalTotalPiasters) } : {}),
            physicallyCompleted: true,
            payloadFingerprint: priced.payloadFingerprint.toLowerCase(),
            couponUsageAccountedSnapshotIssuedAt: null,
            lines: priced.lines,
          };
          if (canonicalOfflineSaleFactsJson(saleFacts(sale)) !== expectedCanonical) {
            throw new SalesValidationError("تعذر حفظ البيع محلياً.");
          }
          await db.sales.add(sale);
          for (const item of quantities) {
            await db.effects.add({
              id: `${input.operationId}:${item.variantId}`,
              staffId: input.staffId,
              operationId: input.operationId,
              variantId: item.variantId,
              branchId: input.branch.id,
              quantity: item.quantity,
            });
          }
          const pending = await db.pending.get(input.staffId);
          if (pending && pending.saleId === input.saleId) {
            await db.pending.delete(input.staffId);
          }
          return sale;
        });
      } catch (error) {
        if (error instanceof SalesValidationError || error instanceof PosStorageError) {
          throw error;
        }
        throw new PosStorageError();
      }
    },

    async recordCompleted(sale, cachedByVariant) {
      await ensureOpen();
      try {
        const expectedCanonical = canonicalOfflineSaleFactsJson(saleFacts(sale));
        const payloadFingerprint = await digestOfflineSale({ ...saleFacts(sale), payloadFingerprint: null });
        if (
          sale.payloadFingerprint &&
          /^[0-9a-f]{64}$/i.test(sale.payloadFingerprint) &&
          sale.payloadFingerprint.toLowerCase() !== payloadFingerprint
        ) {
          throw new SalesValidationError("تعذر حفظ البيع محلياً.");
        }
        return await db.transaction("rw", db.sales, db.effects, db.pending, db.sessions, db.meta, async () => {
          await assertCurrentActor(db, sale.staffId);
          const existing = await db.sales.get(sale.id);
          if (existing) {
            if (!sameRecordedReplay(existing, sale)) {
              throw new SalesValidationError("تعذر حفظ البيع محلياً.");
            }
            return normalizeCompletedSale(existing);
          }
          const quantities = mergeVariantQuantities(sale.lines);
          for (const item of quantities) {
            const pinned = cachedByVariant.get(item.variantId) ?? 0;
            const remaining = await remainingKnownStock(db, sale.branch.id, item.variantId, pinned);
            if (remaining < item.quantity) {
              throw new SalesValidationError("الكمية المتاحة غير كافية.");
            }
          }
          if (canonicalOfflineSaleFactsJson(saleFacts(sale)) !== expectedCanonical) {
            throw new SalesValidationError("تعذر حفظ البيع محلياً.");
          }
          const stored = normalizeCompletedSale({ ...sale, payloadFingerprint });
          await db.sales.add(stored);
          for (const item of quantities) {
            await db.effects.add({
              id: `${sale.operationId}:${item.variantId}`,
              staffId: sale.staffId,
              operationId: sale.operationId,
              variantId: item.variantId,
              branchId: sale.branch.id,
              quantity: item.quantity,
            });
          }
          const pending = await db.pending.get(sale.staffId);
          if (pending && pending.saleId === sale.id) {
            await db.pending.delete(sale.staffId);
          }
          return stored;
        });
      } catch (error) {
        if (error instanceof SalesValidationError || error instanceof PosStorageError) {
          throw error;
        }
        throw new PosStorageError();
      }
    },

    async listUnsynced(staffId) {
      await ensureOpen();
      if (!(await matchesCurrentActor(db, staffId))) {
        return [];
      }
      const rows = await db.sales.toArray();
      return rows
        .filter((row) => row.staffId === staffId && row.syncStatus === "pending")
        .map(normalizeCompletedSale)
        .sort((left, right) => {
          if (left.occurredAt === right.occurredAt) {
            return left.id < right.id ? -1 : 1;
          }
          return left.occurredAt < right.occurredAt ? -1 : 1;
        });
    },

    async listCompleted(staffId) {
      await ensureOpen();
      if (!(await matchesCurrentActor(db, staffId))) {
        return [];
      }
      return (await db.sales.toArray())
        .filter((row) => row.staffId === staffId)
        .map(normalizeCompletedSale);
    },

    async markAcknowledged(staffId, saleId) {
      await ensureOpen();
      await db.transaction("rw", db.sales, db.effects, async () => {
        const sale = await db.sales.get(saleId);
        if (!sale || sale.staffId !== staffId) {
          return;
        }
        await db.sales.update(saleId, { syncStatus: "acknowledged" });
        await db.effects.where("operationId").equals(sale.operationId).delete();
      });
    },

    async applyAcknowledgement(input) {
      await ensureOpen();
      try {
        const proofs = Array.isArray(input.includedOperations) ? input.includedOperations : [];
        const prepared = await prepareLocalDigests(db, proofs);
        await db.transaction("rw", db.sales, db.effects, db.snapshots, db.meta, async () => {
          await applyAcknowledgementRecord(db, input, prepared);
        });
      } catch (error) {
        if (error instanceof PosStorageError || error instanceof SalesValidationError) {
          throw error;
        }
        throw new PosStorageError();
      }
    },

    async countOtherPending(staffId) {
      await ensureOpen();
      if (!(await matchesCurrentActor(db, staffId))) {
        return 0;
      }
      const rows = await db.sales.toArray();
      return rows.filter((row) => row.staffId !== staffId && row.syncStatus === "pending").length;
    },

    async listPreservedPending(staffId) {
      await ensureOpen();
      const current = await currentSignedIn(db);
      if (!current || current.staffId !== staffId) {
        return [];
      }
      if (current.workspace.staff.role !== "manager" || current.workspace.staff.id !== staffId) {
        return [];
      }
      const rows = await db.sales.toArray();
      return rows
        .filter((row) => row.staffId !== staffId && row.syncStatus === "pending")
        .map(normalizeCompletedSale)
        .sort((left, right) => {
          if (left.occurredAt === right.occurredAt) {
            return left.id < right.id ? -1 : 1;
          }
          return left.occurredAt < right.occurredAt ? -1 : 1;
        });
    },

    async listPendingOperationIds() {
      await ensureOpen();
      const rows = await db.sales.toArray();
      return [
        ...new Set(
          rows
            .filter(
              (row) =>
                row.syncStatus === "pending" || (row.appliedCoupon && !row.couponUsageAccountedSnapshotIssuedAt),
            )
            .map((row) => row.operationId),
        ),
      ];
    },

    async readStockVersion() {
      await ensureOpen();
      return readAppliedStockVersion(db);
    },

    async readStockCache() {
      await ensureOpen();
      return readStockCacheRecord(db);
    },

    async loadPending(staffId) {
      await ensureOpen();
      if (!(await matchesCurrentActor(db, staffId))) {
        return null;
      }
      const pending = await db.pending.get(staffId);
      return pending ? toPendingRecord(pending) : null;
    },

    async listRecoverablePending(staffId) {
      await ensureOpen();
      if (!(await matchesCurrentActor(db, staffId))) {
        return [];
      }
      const primary = await db.pending.get(staffId);
      const extras = await db.legacyPending.where("staffId").equals(staffId).toArray();
      const rows: OfflinePendingSale[] = [];
      if (primary) {
        rows.push(primary);
      }
      for (const extra of extras) {
        if (!rows.some((row) => row.saleId === extra.saleId && row.operationId === extra.operationId)) {
          rows.push(extra);
        }
      }
      return rows.map(toPendingRecord);
    },

    async savePending(pending) {
      await ensureOpen();
      return db.transaction("rw", db.pending, db.sessions, db.meta, async () => {
        await assertCurrentActor(db, pending.staffId);
        const stored = await db.pending.get(pending.staffId);
        if (stored && stored.saleId !== pending.saleId && (stored.physicallyCompleted || stored.phase === "uncertain")) {
          return "blocked";
        }
        await db.pending.put(toPendingRecord(pending));
        return "assigned";
      });
    },

    async clearPending(staffId, expectedSaleId) {
      await ensureOpen();
      await db.transaction("rw", db.pending, async () => {
        const stored = await db.pending.get(staffId);
        if (!stored || stored.saleId !== expectedSaleId) {
          return;
        }
        await db.pending.delete(staffId);
      });
    },

    async migrateLegacyMarkers() {
      await ensureOpen();
      if (typeof localStorage === "undefined") {
        return;
      }
      const keys: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.startsWith(LEGACY_PENDING_PREFIX)) {
          keys.push(key);
        }
      }
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) {
          continue;
        }
        let parsed: OfflinePendingSale;
        try {
          parsed = JSON.parse(raw) as OfflinePendingSale;
        } catch {
          continue;
        }
        if (!parsed.staffId || !parsed.saleId || !parsed.operationId) {
          continue;
        }
        try {
          await db.transaction("rw", db.pending, db.legacyPending, async () => {
            const record = toPendingRecord(parsed);
            const existing = await db.pending.get(parsed.staffId);
            if (!existing) {
              await db.pending.put(record);
              return;
            }
            if (existing.saleId === parsed.saleId && existing.operationId === parsed.operationId) {
              return;
            }
            await db.legacyPending.put({ ...record, saleId: parsed.saleId });
          });
          localStorage.removeItem(key);
        } catch {
          /* retain the source until this exact operation is durably preserved */
        }
      }
    },

    async requestPersistentStorage() {
      if (typeof navigator === "undefined" || !navigator.storage?.persist) {
        return null;
      }
      try {
        return await navigator.storage.persist();
      } catch {
        return false;
      }
    },

    async readSchemaVersion() {
      await ensureOpen();
      const blocked = await db.meta.get("upgradeBlocked");
      if (blocked?.value) {
        return 2;
      }
      const stored = await db.meta.get("schemaVersion");
      const parsed = stored?.value ? Number.parseInt(stored.value, 10) : Number.NaN;
      return Number.isInteger(parsed) ? parsed : POS_SCHEMA_VERSION;
    },
  };
}

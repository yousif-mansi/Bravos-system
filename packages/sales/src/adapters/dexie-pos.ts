import type { PosPriceSnapshotDto, WorkspaceDto } from "@bravos/contracts";
import { Dexie, type EntityTable, type Transaction } from "dexie";
import { isDeclaredSafeMigration, POS_SCHEMA_VERSION } from "../domain/pos-update.ts";
import { mergeVariantQuantities } from "../domain/discount.ts";
import { SalesValidationError } from "../domain/errors.ts";
import {
  PosStorageError,
  type CompleteOfflineSaleInput,
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
  return {
    ...sale,
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
  if (existing.branch.id !== input.branch.id) {
    return false;
  }
  if (existing.customerName !== input.customerName || existing.customerPhone !== input.customerPhone) {
    return false;
  }
  if (existing.employeeDiscountPiasters !== input.employeeDiscountPiasters) {
    return false;
  }
  if (existing.discountReason !== input.discountReason) {
    return false;
  }
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
  if (existing.branch.id !== incoming.branch.id) {
    return false;
  }
  if (existing.originalTotalPiasters !== incoming.originalTotalPiasters) {
    return false;
  }
  if (existing.employeeDiscountPiasters !== incoming.employeeDiscountPiasters) {
    return false;
  }
  if (existing.finalTotalPiasters !== incoming.finalTotalPiasters) {
    return false;
  }
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
  return {
    staffId: parsed.staffId,
    saleId: parsed.saleId,
    operationId: parsed.operationId,
    phase: parsed.phase === "prepared" || parsed.phase === "rejected" ? parsed.phase : "uncertain",
    physicallyCompleted: parsed.physicallyCompleted === true,
    digest: typeof parsed.digest === "string" ? parsed.digest : null,
    payload: parsed.payload ?? null,
    occurredAt: typeof parsed.occurredAt === "string" ? parsed.occurredAt : null,
    quote: parsed.quote ?? null,
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
      await db.snapshots.put({ staffId, snapshot });
    },

    async loadSnapshot(staffId) {
      await ensureOpen();
      return (await db.snapshots.get(staffId))?.snapshot ?? null;
    },

    async lookupProduct(staffId, code) {
      const snapshot = await this.loadSnapshot(staffId);
      if (!snapshot) {
        return null;
      }
      const needle = code.trim();
      return snapshot.products.find((product) => product.code === needle) ?? null;
    },

    async availableQuantity(variantId, cachedAvailable) {
      await ensureOpen();
      const outstanding = await db.effects.where("variantId").equals(variantId).toArray();
      const used = outstanding.reduce((sum, effect) => sum + effect.quantity, 0);
      return cachedAvailable - used;
    },

    async completeSale(input: CompleteOfflineSaleInput, priced) {
      await ensureOpen();
      try {
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
            const cached = variant?.availableQuantity ?? 0;
            const outstanding = await db.effects.where("variantId").equals(item.variantId).toArray();
            const used = outstanding.reduce((sum, effect) => sum + effect.quantity, 0);
            if (cached - used < item.quantity) {
              throw new SalesValidationError("الكمية المتاحة غير كافية.");
            }
          }
          const sale: OfflineCompletedSale = {
            id: input.saleId,
            staffId: input.staffId,
            operationId: input.operationId,
            deviceId: input.deviceId,
            snapshotId: input.kind === "accepted" ? input.snapshot.snapshotId : null,
            kind: input.kind,
            syncStatus: "pending",
            branch: input.branch,
            soldByStaffId: input.staffId,
            soldByDisplayName: input.soldByDisplayName,
            occurredAt: input.occurredAt,
            recordedAt: null,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            originalTotalPiasters: priced.originalTotalPiasters,
            employeeDiscountPiasters: input.employeeDiscountPiasters,
            discountReason: input.discountReason,
            discountedByStaffId: input.employeeDiscountPiasters > 0 ? input.staffId : null,
            finalTotalPiasters: priced.finalTotalPiasters,
            physicallyCompleted: true,
            lines: priced.lines,
          };
          await db.sales.add(sale);
          for (const item of quantities) {
            await db.effects.add({
              id: `${input.operationId}:${item.variantId}`,
              staffId: input.staffId,
              operationId: input.operationId,
              variantId: item.variantId,
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
            const cached = cachedByVariant.get(item.variantId) ?? 0;
            const outstanding = await db.effects.where("variantId").equals(item.variantId).toArray();
            const used = outstanding.reduce((sum, effect) => sum + effect.quantity, 0);
            if (cached - used < item.quantity) {
              throw new SalesValidationError("الكمية المتاحة غير كافية.");
            }
          }
          await db.sales.add(sale);
          for (const item of quantities) {
            await db.effects.add({
              id: `${sale.operationId}:${item.variantId}`,
              staffId: sale.staffId,
              operationId: sale.operationId,
              variantId: item.variantId,
              quantity: item.quantity,
            });
          }
          const pending = await db.pending.get(sale.staffId);
          if (pending && pending.saleId === sale.id) {
            await db.pending.delete(sale.staffId);
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

    async listUnsynced(staffId) {
      await ensureOpen();
      if (!(await matchesCurrentActor(db, staffId))) {
        return [];
      }
      const rows = await db.sales.toArray();
      return rows.filter((row) => row.staffId === staffId && row.syncStatus === "pending").map(normalizeCompletedSale);
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

    async loadPending(staffId) {
      await ensureOpen();
      if (!(await matchesCurrentActor(db, staffId))) {
        return null;
      }
      return (await db.pending.get(staffId)) ?? null;
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
      return rows;
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

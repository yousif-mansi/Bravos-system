import type {
  InventoryBatchDto,
  InventorySettingsDto,
  LowStockVariantDto,
  VariantLowStockDto,
} from "@bravos/contracts";
import {
  ForbiddenError,
  isManager,
  UnauthenticatedError,
} from "@bravos/identity";
import { InventoryValidationError } from "../domain/errors.ts";
import { assertThreshold } from "../domain/money.ts";
import type {
  InventoryActorPort,
  InventoryReadStore,
  InventoryServices,
  VariantIdentityReader,
  VerifiedAuth,
} from "./ports.ts";

const SETTINGS_KEYS = new Set(["lowStockThreshold"]);
const VARIANT_THRESHOLD_KEYS = new Set(["lowStockThreshold"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createInventoryServices(ports: {
  store: InventoryReadStore;
  actors: InventoryActorPort;
  variants: VariantIdentityReader;
}): InventoryServices {
  async function requireManager(auth: VerifiedAuth | null) {
    if (!auth) {
      throw new UnauthenticatedError();
    }
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) {
      throw new UnauthenticatedError();
    }
    if (!isManager(staff)) {
      throw new ForbiddenError();
    }
    return staff;
  }

  async function hydrateVariants(ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await ports.variants.getVariants(unique);
    const byId = new Map(found.map((item) => [item.id, item]));
    return byId;
  }

  return {
    quantitiesFor(variantIds) {
      return ports.store.quantitiesFor(variantIds);
    },

    referencedVariantIds(variantIds) {
      return ports.store.referencedVariantIds(variantIds);
    },

    async listBatches(auth) {
      await requireManager(auth);
      const rows = await ports.store.listBatches();
      const variants = await hydrateVariants(rows.map((row) => row.variantId));
      return rows.map((row) => toBatchDto(row, variants.get(row.variantId)));
    },

    async listLowStock(auth) {
      await requireManager(auth);
      const [ids, settings, overrides] = await Promise.all([
        ports.variants.listIds(),
        ports.store.getSettings(),
        ports.store.listVariantThresholds(),
      ]);
      const quantities = await ports.store.quantitiesFor(ids);
      const low: Array<Omit<LowStockVariantDto, "variant">> = [];
      for (const variantId of ids) {
        const availableQuantity = quantities.get(variantId) ?? 0;
        const override = overrides.get(variantId);
        const threshold = override ?? settings.lowStockThreshold;
        if (availableQuantity > threshold) {
          continue;
        }
        low.push({
          variantId,
          availableQuantity,
          threshold,
          thresholdSource: override === undefined || override === null ? "global" : "variant",
        });
      }
      const variants = await hydrateVariants(low.map((row) => row.variantId));
      return low.map((row) => {
        const variant = variants.get(row.variantId);
        if (!variant) {
          throw new InventoryValidationError("المتغير المحدد غير موجود.");
        }
        return { ...row, variant };
      });
    },

    async getSettings(auth) {
      await requireManager(auth);
      const settings = await ports.store.getSettings();
      return { lowStockThreshold: settings.lowStockThreshold };
    },

    async updateSettings(auth, input) {
      const staff = await requireManager(auth);
      const body = expectObject(input, "بيانات إعداد المخزون غير صالحة.");
      assertAllowedKeys(body, SETTINGS_KEYS, "بيانات إعداد المخزون غير صالحة.");
      const lowStockThreshold = assertThreshold(body.lowStockThreshold, "حد التنبيه غير صالح.");
      const settings = await ports.store.updateSettings(lowStockThreshold, staff.id);
      return { lowStockThreshold: settings.lowStockThreshold };
    },

    async setVariantThreshold(auth, variantId, input) {
      const staff = await requireManager(auth);
      const id = assertUuid(variantId, "المتغير المحدد غير موجود.");
      const identities = await ports.variants.getVariants([id]);
      if (!identities[0]) {
        throw new InventoryValidationError("المتغير المحدد غير موجود.");
      }
      const body = expectObject(input, "بيانات حد التنبيه غير صالحة.");
      assertAllowedKeys(body, VARIANT_THRESHOLD_KEYS, "بيانات حد التنبيه غير صالحة.");
      if (body.lowStockThreshold === null) {
        return ports.store.clearVariantThreshold(id, staff.id);
      }
      const threshold = assertThreshold(body.lowStockThreshold, "حد التنبيه غير صالح.");
      return ports.store.upsertVariantThreshold(id, threshold, staff.id);
    },
  };
}

export function createInventoryAvailabilityReader(store: Pick<InventoryReadStore, "quantitiesFor">) {
  return {
    quantitiesFor(variantIds: string[]) {
      return store.quantitiesFor(variantIds);
    },
  };
}

export function createInventoryReferenceReader(store: Pick<InventoryReadStore, "referencedVariantIds">) {
  return {
    idsWithInventory(variantIds: string[]) {
      return store.referencedVariantIds(variantIds);
    },
  };
}

function toBatchDto(
  row: {
    id: string;
    variantId: string;
    receivedQuantity: number;
    effectiveReceivedQuantity: number;
    remainingQuantity: number;
    unitCostPiasters: number;
    effectiveUnitCostPiasters: number;
    recordedAt: Date;
    receiptId: string;
    receiptDate: string;
  },
  variant: InventoryBatchDto["variant"] | undefined,
): InventoryBatchDto {
  if (!variant) {
    throw new InventoryValidationError("المتغير المحدد غير موجود.");
  }
  return {
    id: row.id,
    variantId: row.variantId,
    receivedQuantity: row.receivedQuantity,
    effectiveReceivedQuantity: row.effectiveReceivedQuantity,
    remainingQuantity: row.remainingQuantity,
    unitCostPiasters: row.unitCostPiasters,
    effectiveUnitCostPiasters: row.effectiveUnitCostPiasters,
    recordedAt: row.recordedAt.toISOString(),
    receiptId: row.receiptId,
    receiptDate: row.receiptDate,
    variant,
  };
}

function expectObject(value: unknown, messageAr: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InventoryValidationError(messageAr);
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(body: Record<string, unknown>, allowed: Set<string>, messageAr: string) {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new InventoryValidationError(messageAr);
    }
  }
}

function assertUuid(value: unknown, messageAr: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new InventoryValidationError(messageAr);
  }
  return value;
}

export type { InventoryServices, VariantLowStockDto, InventorySettingsDto };

import type { OpeningImportLineErrorDto, OpeningImportPreviewDto } from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";
import type { OpeningImportPlan } from "../domain/model.ts";

export type { VerifiedAuth };

export type OpeningImportActorPort = { getStaff(staffId: string): Promise<AuthenticatedStaff | null> };

export type OpeningImportStore = {
  getPreview(id: string): Promise<OpeningImportPreviewDto | null>;
  run<T>(work: (transaction: OpeningImportTransaction) => Promise<T>): Promise<T>;
};

export type OpeningImportPreviewRecord = {
  id: string;
  operationId: string;
  inputFingerprint: string;
  previewFingerprint: string;
  status: "invalid" | "ready" | "accepted";
  plan: OpeningImportPlan;
  state: unknown;
  response: OpeningImportPreviewDto;
};

export type OpeningImportCatalogPlan = {
  categories: OpeningImportPlan["categories"];
  sizes: OpeningImportPlan["sizes"];
  colors: OpeningImportPlan["colors"];
  products: OpeningImportPlan["products"];
  variants: OpeningImportPlan["variants"];
  referencedVariants: OpeningImportReference[];
  referencedProducts: OpeningImportReference[];
  referencedCategories: OpeningImportReference[];
  referencedSizes: OpeningImportReference[];
  referencedColors: OpeningImportReference[];
};

export type OpeningImportReference = {
  id: string;
  file: OpeningImportLineErrorDto["file"];
  line: number;
  column: string;
};

export type OpeningImportTransaction = {
  findByOperation(operationId: string): Promise<OpeningImportPreviewRecord | null>;
  findById(previewId: string): Promise<OpeningImportPreviewRecord | null>;
  insertPreview(input: OpeningImportPreviewRecord & { actorStaffId: string; createdAt: Date }): Promise<void>;
  markAccepted(input: { previewId: string; response: OpeningImportPreviewDto; actorStaffId: string; acceptedAt: Date }): Promise<void>;
  catalog: {
    inspect(plan: OpeningImportCatalogPlan): Promise<{ state: unknown; errors: OpeningImportLineErrorDto[] }>;
    insert(plan: OpeningImportCatalogPlan, actorStaffId: string, at: Date): Promise<void>;
  };
  inventory: {
    openingImportState(variantIds: string[]): Promise<{ stockVersion: number; defaultThreshold: number; variantThresholds: Array<{ variantId: string; threshold: number | null }> }>;
    lockStockClock(mode: "share" | "update"): Promise<void>;
    assertStockMutationAllowed(): Promise<void>;
    claimOpeningImportOperation(input: { operationId: string; payloadFingerprint: string; actorStaffId: string }): Promise<{ kind: "created" | "replay" }>;
    importOpeningBatches(input: { operationId: string; receiptId: string; lines: Array<{ lineId: string; batchId: string; movementId: string; variantId: string; quantity: number; unitCostPiasters: number; receiptDate: string; recordedAt: Date }> }): Promise<unknown>;
    applyOpeningSettings(input: { actorStaffId: string; at: Date; defaultThreshold: number | null; variantThresholds: Array<{ variantId: string; threshold: number }> }): Promise<void>;
    bumpStockVersion(): Promise<number>;
  };
  receiving: { insertOpeningReceipt(input: { receiptId: string; operationId: string; receiptDate: string; actorStaffId: string; recordedAt: Date; lines: Array<{ id: string; variantId: string; quantity: number; unitCostPiasters: number; batchId: string; lineIndex: number }> }): Promise<void> };
  expenses: { inspectOpeningCategories(rows: Array<{ nameAr: string; line: number }>): Promise<{ state: unknown; errors: OpeningImportLineErrorDto[] }>; insertOpeningCategories(rows: Array<{ id: string; nameAr: string; active: boolean }>, actorStaffId: string, at: Date): Promise<void> };
  pricing: { inspectOpeningPricing(input: { offers: Array<{ key: string; nameAr: string; line: number }>; coupons: Array<{ normalizedCode: string; line: number }> }): Promise<{ state: unknown; errors: OpeningImportLineErrorDto[] }>; insertOpeningPricing(input: { offers: Array<OpeningImportPlan["offers"][number] & { actorStaffId: string; changedAt: Date }>; coupons: Array<OpeningImportPlan["coupons"][number] & { actorStaffId: string; changedAt: Date }> }): Promise<void> };
  storefront: { inspectOpeningContacts(): Promise<{ whatsappUrl: string | null; facebookUrl: string | null; instagramUrl: string | null; tiktokUrl: string | null }>; upsertOpeningContacts(input: { whatsappUrl: string | null; facebookUrl: string | null; instagramUrl: string | null; tiktokUrl: string | null; actorStaffId: string; at: Date }): Promise<void> };
  orders: { inspectOpeningConfiguration(rows: Array<{ nameAr: string; line: number }>): Promise<{ state: unknown; settings: { unreachableWaitHours: number; minimumContactAttempts: number }; errors: OpeningImportLineErrorDto[] }>; insertOpeningConfiguration(input: { areas: Array<{ id: string; nameAr: string; feePiasters: number; active: boolean }>; settings: { unreachableWaitHours: number; minimumContactAttempts: number } | null; actorStaffId: string; at: Date }): Promise<void> };
};

export type OpeningImportServices = {
  authorizeTemplate(auth: VerifiedAuth | null): Promise<void>;
  preview(auth: VerifiedAuth | null, input: unknown): Promise<{ value: OpeningImportPreviewDto; created: boolean }>;
  get(auth: VerifiedAuth | null, id: string): Promise<OpeningImportPreviewDto>;
  accept(auth: VerifiedAuth | null, id: string, input: unknown): Promise<{ value: OpeningImportPreviewDto; created: boolean }>;
};

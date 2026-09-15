import type { ReturnCorrectionDetailDto, SaleCorrectionDetailDto } from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";

export type { VerifiedAuth };

export type CorrectionsActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
};

export type CashFactWrite = { direction: "paid_out" | "recovered"; amountPiasters: number } | null;
export type MerchandiseAdjustmentWrite = { lineId: string; quantityDelta: number };
export type SaleValueWrite = {
  finalTotalPiasters: number;
  lines: Array<{
    lineId: string;
    quantity: number;
    paidPiasters: number;
    paidRanges: Array<{ quantity: number; paidUnitPiasters: number }>;
  }>;
} | null;
export type ReturnValueWrite = {
  authorizedRefundPiasters: number;
  lines: Array<{ lineId: string; quantity: number; sellableQuantity: number }>;
} | null;

export type SaleCorrectionWrite = {
  correctionId: string;
  operationId: string;
  saleId: string;
  expectedRevision: number;
  type: "correction" | "cancellation";
  reason: string;
  effective: SaleValueWrite;
  merchandise: MerchandiseAdjustmentWrite[];
  cash: CashFactWrite;
  payloadFingerprint: string;
  actorStaffId: string;
  at: Date;
};

export type ReturnCorrectionWrite = Omit<SaleCorrectionWrite, "saleId" | "effective"> & {
  returnId: string;
  effective: ReturnValueWrite;
};

export type ChangeResult<T> =
  | { kind: "created" | "replay"; value: T }
  | { kind: "not-found" }
  | { kind: "stale" };

export type CorrectionsRepository = {
  getSale(saleId: string, revision?: number): Promise<SaleCorrectionDetailDto | null>;
  changeSale(input: SaleCorrectionWrite): Promise<ChangeResult<SaleCorrectionDetailDto>>;
  getReturn(returnId: string, revision?: number): Promise<ReturnCorrectionDetailDto | null>;
  changeReturn(input: ReturnCorrectionWrite): Promise<ChangeResult<ReturnCorrectionDetailDto>>;
};

export type CorrectionServices = {
  getSale(auth: VerifiedAuth | null, saleId: string): Promise<SaleCorrectionDetailDto>;
  changeSale(auth: VerifiedAuth | null, saleId: string, input: unknown): Promise<{ value: SaleCorrectionDetailDto; created: boolean }>;
  getReturn(auth: VerifiedAuth | null, returnId: string): Promise<ReturnCorrectionDetailDto>;
  changeReturn(auth: VerifiedAuth | null, returnId: string, input: unknown): Promise<{ value: ReturnCorrectionDetailDto; created: boolean }>;
};

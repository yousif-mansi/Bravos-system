import type {
  ReturnCorrectionDetailDto,
  ReturnDto,
  ReturnExchangeQuoteDto,
  ReturnListPageDto,
  ReturnSourceDto,
} from "@bravos/contracts";
import { request, type SaleCorrectionWrite } from "./api.ts";

export type ReturnSourceSearch = {
  reference?: string;
  date?: string;
  branchId?: string;
  item?: string;
  amountPiasters?: number;
  channel?: "physical" | "online";
};

export function listReturnSources(search: ReturnSourceSearch = {}) {
  const query = new URLSearchParams();
  if (search.reference) query.set("reference", search.reference);
  if (search.date) query.set("date", search.date);
  if (search.branchId) query.set("branchId", search.branchId);
  if (search.item) query.set("item", search.item);
  if (search.amountPiasters !== undefined) query.set("amountPiasters", String(search.amountPiasters));
  if (search.channel) query.set("channel", search.channel);
  const suffix = query.size ? `?${query.toString()}` : "";
  return request<ReturnSourceDto[]>(`/api/internal/returns/sources${suffix}`);
}

export function createReturnDraft(input: {
  returnId: string;
  operationId: string;
  source: { kind: "physical_sale" | "delivered_online_order"; id: string };
  handlingBranchId: string;
  authorizedRefund: { merchandisePiasters: number; checkoutChargePiasters: number };
  lines: Array<{ sourceLineId: string; quantity: number; sellableQuantity: number }>;
}) {
  return request<ReturnDto>("/api/internal/returns", { method: "POST", body: JSON.stringify(input) });
}

export function updateReturnDraft(returnId: string, input: {
  expectedRevision: number;
  handlingBranchId: string;
  authorizedRefund: { merchandisePiasters: number; checkoutChargePiasters: number };
  lines: Array<{ sourceLineId: string; quantity: number; sellableQuantity: number }>;
}) {
  return request<ReturnDto>(`/api/internal/returns/${returnId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function postReturn(returnId: string, expectedRevision: number) {
  return request<ReturnDto>(`/api/internal/returns/${returnId}/post`, {
    method: "POST",
    body: JSON.stringify({ receivedAndInspected: true, expectedRevision }),
  });
}

export function payReturnRefund(returnId: string, amountPiasters: number, operationId: string) {
  return request<ReturnDto>(`/api/internal/returns/${returnId}/refund`, {
    method: "POST",
    body: JSON.stringify({ operationId, status: "paid", amountPiasters }),
  });
}

export function quoteReturnExchange(returnId: string, input: {
  quoteId: string;
  exchangeId: string;
  operationId: string;
  replacementSaleId: string;
  replacementSaleOperationId: string;
  expectedRevision: number;
  replacementLines: Array<{ variantId: string; quantity: number }>;
}) {
  return request<ReturnExchangeQuoteDto>(`/api/internal/returns/${returnId}/exchange-quote`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function completeReturnExchange(returnId: string, input: {
  exchangeId: string;
  operationId: string;
  replacementSaleId: string;
  replacementSaleOperationId: string;
  receivedAndInspected: true;
  expectedRevision: number;
  cashRefundStatus: "owed" | "paid";
  quoteId: string;
}) {
  return request<ReturnDto>(`/api/internal/returns/${returnId}/exchange`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listReturns(input: { limit?: number; cursor?: string } = {}) {
  const query = new URLSearchParams();
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  if (input.cursor) query.set("cursor", input.cursor);
  const suffix = query.size ? `?${query.toString()}` : "";
  return request<ReturnListPageDto>(`/api/internal/returns${suffix}`);
}

export function getReturn(returnId: string) {
  return request<ReturnDto>(`/api/internal/returns/${returnId}`);
}

export type ReturnCorrectionWrite = Omit<SaleCorrectionWrite, "effective"> & {
  effective: {
    authorizedRefund: { merchandisePiasters: number; checkoutChargePiasters: number };
    lines: Array<{ lineId: string; quantity: number; sellableQuantity: number }>;
  } | null;
};

export function getReturnCorrection(returnId: string) {
  return request<ReturnCorrectionDetailDto>(`/api/internal/corrections/returns/${returnId}`);
}

export function changeReturnCorrection(returnId: string, input: ReturnCorrectionWrite) {
  return request<ReturnCorrectionDetailDto>(`/api/internal/corrections/returns/${returnId}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

import { createHash } from "node:crypto";
import {
  canonicalAcceptedSalePayloadJson,
  canonicalSalePayloadJson,
  normalizeAcceptedSalePayload,
  normalizeSalePayload,
  type AcceptedSalePayload,
  type SalePayload,
} from "./canonical-payload.ts";

export type { AcceptedSalePayload, SalePayload };

export { normalizeAcceptedSalePayload, normalizeSalePayload };

export function fingerprintSalePayload(input: SalePayload): string {
  return createHash("sha256").update(canonicalSalePayloadJson(input)).digest("hex");
}

export function fingerprintAcceptedSalePayload(input: AcceptedSalePayload): string {
  return createHash("sha256").update(canonicalAcceptedSalePayloadJson(input)).digest("hex");
}

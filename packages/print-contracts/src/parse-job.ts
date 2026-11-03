import { parseLabelJob, type LabelJob } from "./label-job.ts";
import { parseReceiptJob, type ReceiptJob } from "./receipt-job.ts";

export type PrintJob = LabelJob | ReceiptJob;

export function parsePrintJob(value: unknown): PrintJob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "label") return parseLabelJob(value);
  if (kind === "receipt") return parseReceiptJob(value);
  return null;
}

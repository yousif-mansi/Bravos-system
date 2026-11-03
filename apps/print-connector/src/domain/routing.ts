import { LABEL_PRINTER_NAME, RECEIPT_PRINTER_NAME, type PrintJob } from "../contracts.ts";

export function routeJob(job: PrintJob): { printerName: typeof LABEL_PRINTER_NAME | typeof RECEIPT_PRINTER_NAME } {
  if (job.kind === "label") return { printerName: LABEL_PRINTER_NAME };
  return { printerName: RECEIPT_PRINTER_NAME };
}

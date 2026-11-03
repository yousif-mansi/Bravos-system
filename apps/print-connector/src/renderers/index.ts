export { encodeProductCode } from "./barcode.ts";
export {
  LABEL_CONTENT_WIDTH_DOTS,
  LABEL_HEIGHT_DOTS,
  LABEL_MIN_BAR_DOTS,
  LABEL_WIDTH_DOTS,
  QUIET_ZONE_MODULES,
  RECEIPT_MAX_PAGE_DOTS,
  RECEIPT_PAPER_WIDTH_DOTS,
  barcodeWidthDots,
  dotsFromHundredths,
  hundredthsOfDots,
  mmToDots,
  moduleDotsFor,
} from "./geometry.ts";
export { prepareNativeJob } from "./job.ts";
export type { NativeEnvelope, NativeFailureCode, PreparedNativeJob } from "./job.ts";
export {
  LABEL_DRIVER_NAME,
  RECEIPT_DRIVER_NAME,
  judgeObservedQueue,
} from "./probe.ts";
export type { ObservedPrinters, ObservedQueue, QueueState } from "./probe.ts";
export {
  PREVIEW_TIMEOUT_MS,
  PRINT_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  defaultNativeHelperPath,
  nativeSpawnOptions,
  planNativeHelperSpawn,
} from "./spawn.ts";
export type { HelperExit, NativeHelperRun, NativeSpawnPlan } from "./spawn.ts";
export {
  interpretPrintExit,
  previewNativeJob,
  probeNativePrinters,
  submitNativePrint,
} from "./api.ts";
export type { NativePreviewResult, NativePrintResult, NativeProbeResult } from "./api.ts";

/** Importing this module does not listen, spawn, or submit a job. */
export const nativeModuleEffects = { spawnsOnImport: false, listensOnImport: false } as const;

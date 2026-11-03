import type { PrintDispatch } from "../ports.ts";
import {
  envelopeJson,
  prepareNativeJob,
  type NativeEnvelope,
  type NativeFailureCode,
  type PreparedNativeJob,
} from "./job.ts";
import {
  failureCodeForState,
  judgeObservedQueue,
  type ObservedDevice,
  type ObservedPrinters,
  type ObservedQueue,
  type QueueRole,
} from "./probe.ts";
import {
  defaultNativeHelperPath,
  planNativeHelperSpawn,
  PREVIEW_STDOUT_MAX,
  PREVIEW_TIMEOUT_MS,
  PRINT_STDOUT_MAX,
  PRINT_TIMEOUT_MS,
  PROBE_STDOUT_MAX,
  PROBE_TIMEOUT_MS,
  runNativeHelper,
  type HelperExit,
  type NativeHelperRun,
} from "./spawn.ts";

export type NativeHelperRunner = (run: NativeHelperRun) => Promise<HelperExit>;

export type NativeCallOptions = {
  platform?: string;
  systemRoot?: string;
  helperPath?: string;
  runner?: NativeHelperRunner;
  observations?: ObservedPrinters;
};

export type NativePrintResult =
  | { outcome: "submitted" }
  | { outcome: "failed"; code: NativeFailureCode }
  | { outcome: "unknown" };

export type PreviewLine = {
  page: number;
  role: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  clipped: false;
};

export type PreviewPage = {
  widthDots: number;
  heightDots: number;
  pngBase64: string;
  ink: { minX: number; minY: number; maxX: number; maxY: number };
};

export type NativePreviewResult =
  | {
    ok: true;
    outcome: "preview";
    printInvoked: false;
    kind: "label" | "receipt";
    copies: number;
    dpi: 203;
    moduleDots: 1 | 2 | null;
    quietModules: number | null;
    barcodeModules: number | null;
    barcodeWidthDots: number | null;
    barHeightDots: number | null;
    pageWidthDots: number;
    pageHeightDots: number;
    maxPageHeightDots: number | null;
    pages: PreviewPage[];
    lines: PreviewLine[];
  }
  | { ok: false; outcome: "failed"; code: NativeFailureCode; printInvoked: false };

export type NativeProbeResult =
  | { ok: true; outcome: "probe"; printInvoked: false; label: "ready" | "missing" | "offline" | "unsupported"; receipt: "ready" | "missing" | "offline" | "unsupported" }
  | { ok: false; outcome: "failed"; code: NativeFailureCode; printInvoked: false };

const FAILURES = new Set<NativeFailureCode>([
  "printer_missing",
  "printer_offline",
  "unsupported_driver",
  "renderer_unavailable",
  "unsupported_platform",
  "invalid_layout",
  "invalid_job",
]);

function systemRootFrom(options: NativeCallOptions | undefined): string {
  return options?.systemRoot ?? process.env.SystemRoot ?? "C:\\Windows";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseExitObject(exit: HelperExit): Record<string, unknown> | null {
  if (exit.spawnError || exit.timedOut || exit.overflow || exit.stdout.length < 2) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(exit.stdout.toString("utf8"));
  } catch {
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

function failureCode(value: unknown): NativeFailureCode | null {
  return typeof value === "string" && FAILURES.has(value as NativeFailureCode) ? value as NativeFailureCode : null;
}

export function interpretPrintExit(exit: HelperExit): NativePrintResult {
  if (exit.spawnError) return { outcome: "failed", code: "renderer_unavailable" };
  if (exit.timedOut || exit.overflow) return { outcome: "unknown" };
  const record = parseExitObject(exit);
  if (!record) return { outcome: "unknown" };
  if (record.outcome === "submitted" && record.printInvoked === true && record.ok === true) {
    return { outcome: "submitted" };
  }
  const code = failureCode(record.code);
  if (record.outcome === "failed" && record.printInvoked === false && code) {
    return { outcome: "failed", code };
  }
  return { outcome: "unknown" };
}

function interpretPreviewExit(exit: HelperExit): NativePreviewResult {
  if (exit.spawnError || exit.timedOut || exit.overflow) {
    return { ok: false, outcome: "failed", code: "renderer_unavailable", printInvoked: false };
  }
  const record = parseExitObject(exit);
  if (!record || record.printInvoked !== false) {
    return { ok: false, outcome: "failed", code: "renderer_unavailable", printInvoked: false };
  }
  const code = failureCode(record.code);
  if (record.outcome === "failed" && code) {
    return { ok: false, outcome: "failed", code, printInvoked: false };
  }
  const preview = readPreview(record);
  if (!preview) return { ok: false, outcome: "failed", code: "renderer_unavailable", printInvoked: false };
  return preview;
}

function readPreview(record: Record<string, unknown>): NativePreviewResult | null {
  if (record.ok !== true || record.outcome !== "preview" || record.printInvoked !== false) return null;
  if (record.kind !== "label" && record.kind !== "receipt") return null;
  if (record.dpi !== 203 || typeof record.copies !== "number" || !Number.isInteger(record.copies)) return null;
  if (typeof record.pageWidthDots !== "number" || typeof record.pageHeightDots !== "number") return null;
  const pages = readPages(record.pages);
  const lines = readLines(record.lines);
  if (!pages || !lines) return null;
  const moduleDots = record.moduleDots === 1 || record.moduleDots === 2 ? record.moduleDots : null;
  if (record.kind === "label" && moduleDots === null) return null;
  return {
    ok: true,
    outcome: "preview",
    printInvoked: false,
    kind: record.kind,
    copies: record.copies,
    dpi: 203,
    moduleDots,
    quietModules: typeof record.quietModules === "number" ? record.quietModules : null,
    barcodeModules: typeof record.barcodeModules === "number" ? record.barcodeModules : null,
    barcodeWidthDots: typeof record.barcodeWidthDots === "number" ? record.barcodeWidthDots : null,
    barHeightDots: typeof record.barHeightDots === "number" ? record.barHeightDots : null,
    pageWidthDots: record.pageWidthDots,
    pageHeightDots: record.pageHeightDots,
    maxPageHeightDots: typeof record.maxPageHeightDots === "number" ? record.maxPageHeightDots : null,
    pages,
    lines,
  };
}

function readPages(value: unknown): PreviewPage[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) return null;
  const pages: PreviewPage[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (typeof item.widthDots !== "number" || typeof item.heightDots !== "number") return null;
    if (typeof item.pngBase64 !== "string" || item.pngBase64.length < 32 || item.pngBase64.length > 500_000) return null;
    if (!isRecord(item.ink)) return null;
    const { minX, minY, maxX, maxY } = item.ink;
    if (typeof minX !== "number" || typeof minY !== "number" || typeof maxX !== "number" || typeof maxY !== "number") return null;
    pages.push({
      widthDots: item.widthDots,
      heightDots: item.heightDots,
      pngBase64: item.pngBase64,
      ink: { minX, minY, maxX, maxY },
    });
  }
  return pages;
}

function readLines(value: unknown): PreviewLine[] | null {
  if (!Array.isArray(value) || value.length > 800) return null;
  const lines: PreviewLine[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (item.clipped !== false) return null;
    if (typeof item.page !== "number" || typeof item.role !== "string" || typeof item.text !== "string") return null;
    if (typeof item.x !== "number" || typeof item.y !== "number" || typeof item.w !== "number" || typeof item.h !== "number") return null;
    if (item.text.length > 200) return null;
    lines.push({
      page: item.page,
      role: item.role,
      text: item.text,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      clipped: false,
    });
  }
  return lines;
}

function readDevice(value: unknown): ObservedDevice | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.status !== "string") return null;
  if (value.id.length < 12 || value.id.length > 180 || value.status.length > 40) return null;
  return { id: value.id, status: value.status };
}

function readQueue(value: unknown): ObservedQueue | null {
  if (!isRecord(value)) return null;
  if (typeof value.found !== "boolean" || typeof value.workOffline !== "boolean" || typeof value.truncated !== "boolean") return null;
  if (typeof value.driverName !== "string" || typeof value.portName !== "string" || typeof value.status !== "string") return null;
  if (!Array.isArray(value.devices) || value.devices.length > 16) return null;
  const devices: ObservedDevice[] = [];
  for (const device of value.devices) {
    const parsed = readDevice(device);
    if (!parsed) return null;
    devices.push(parsed);
  }
  return {
    found: value.found,
    driverName: value.driverName,
    workOffline: value.workOffline,
    portName: value.portName,
    status: value.status,
    truncated: value.truncated,
    devices,
  };
}

function interpretProbeExit(exit: HelperExit): NativeProbeResult {
  if (exit.spawnError || exit.timedOut || exit.overflow) {
    return { ok: false, outcome: "failed", code: "renderer_unavailable", printInvoked: false };
  }
  const record = parseExitObject(exit);
  if (!record || record.printInvoked !== false) {
    return { ok: false, outcome: "failed", code: "renderer_unavailable", printInvoked: false };
  }
  const code = failureCode(record.code);
  if (record.outcome === "failed" && code) {
    return { ok: false, outcome: "failed", code, printInvoked: false };
  }
  if (record.ok !== true || record.outcome !== "probe" || !isRecord(record.queues)) {
    return { ok: false, outcome: "failed", code: "renderer_unavailable", printInvoked: false };
  }
  const label = readQueue(record.queues.label);
  const receipt = readQueue(record.queues.receipt);
  if (!label || !receipt) return { ok: false, outcome: "failed", code: "renderer_unavailable", printInvoked: false };
  return {
    ok: true,
    outcome: "probe",
    printInvoked: false,
    label: judgeObservedQueue("label", label),
    receipt: judgeObservedQueue("receipt", receipt),
  };
}

async function execute(action: "probe" | "preview" | "print", job: NativeEnvelope["job"], options: NativeCallOptions | undefined): Promise<HelperExit> {
  const envelope: NativeEnvelope = { action, job };
  const stdin = envelopeJson(envelope);
  if (!stdin) {
    return { code: null, stdout: Buffer.alloc(0), timedOut: false, spawnError: true, overflow: false };
  }
  const plan = planNativeHelperSpawn({
    systemRoot: systemRootFrom(options),
    helperPath: options?.helperPath ?? defaultNativeHelperPath(),
  });
  const timeoutMs = action === "probe" ? PROBE_TIMEOUT_MS : action === "preview" ? PREVIEW_TIMEOUT_MS : PRINT_TIMEOUT_MS;
  const stdoutMax = action === "probe" ? PROBE_STDOUT_MAX : action === "preview" ? PREVIEW_STDOUT_MAX : PRINT_STDOUT_MAX;
  const run: NativeHelperRun = { plan, stdin, timeoutMs, stdoutMax, action };
  const runner = options?.runner ?? runNativeHelper;
  return runner(run);
}

export async function probeNativePrinters(options: NativeCallOptions = {}): Promise<NativeProbeResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { ok: false, outcome: "failed", code: "unsupported_platform", printInvoked: false };
  if (options.observations) {
    return {
      ok: true,
      outcome: "probe",
      printInvoked: false,
      label: judgeObservedQueue("label", options.observations.label),
      receipt: judgeObservedQueue("receipt", options.observations.receipt),
    };
  }
  try {
    return interpretProbeExit(await execute("probe", null, options));
  } catch {
    return { ok: false, outcome: "failed", code: "renderer_unavailable", printInvoked: false };
  }
}

export async function previewNativeJob(dispatch: PrintDispatch, options: NativeCallOptions = {}): Promise<NativePreviewResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { ok: false, outcome: "failed", code: "unsupported_platform", printInvoked: false };
  const prepared = prepareNativeJob(dispatch);
  if (!prepared.ok) return { ok: false, outcome: "failed", code: prepared.code, printInvoked: false };
  try {
    return interpretPreviewExit(await execute("preview", prepared.job, options));
  } catch {
    return { ok: false, outcome: "failed", code: "renderer_unavailable", printInvoked: false };
  }
}

async function liveQueueState(role: QueueRole, options: NativeCallOptions): Promise<NativeFailureCode | null> {
  const probed = await probeNativePrinters(options);
  if (!probed.ok) return probed.code;
  const state = role === "label" ? probed.label : probed.receipt;
  return failureCodeForState(state);
}

export async function submitNativePrint(dispatch: PrintDispatch, options: NativeCallOptions = {}): Promise<NativePrintResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { outcome: "failed", code: "unsupported_platform" };
  const prepared = prepareNativeJob(dispatch);
  if (!prepared.ok) return { outcome: "failed", code: prepared.code };
  if (options.observations) {
    const state = judgeObservedQueue(prepared.kind, options.observations[prepared.kind]);
    const code = failureCodeForState(state);
    if (code) return { outcome: "failed", code };
    if (!options.runner) return { outcome: "failed", code: "renderer_unavailable" };
  } else if (!options.runner) {
    const code = await liveQueueState(prepared.kind, options);
    if (code) return { outcome: "failed", code };
  }
  try {
    return interpretPrintExit(await execute("print", prepared.job, options));
  } catch {
    return { outcome: "unknown" };
  }
}

export { prepareNativeJob };

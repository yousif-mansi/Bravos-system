import {
  LABEL_PRINTER_NAME,
  PAIRING_CODE_LENGTH,
  PRINT_CONNECTOR_HOST,
  PRINT_CONNECTOR_PORT,
  RECEIPT_PRINTER_NAME,
  parsePrintJob,
} from "@bravos/print-contracts";

/** Fixed loopback connector. Callers cannot supply a URL, printer, or document path. */
export const PRINT_CONNECTOR_ORIGIN = `http://${PRINT_CONNECTOR_HOST}:${PRINT_CONNECTOR_PORT}`;

/** Origin-scoped device preference. Logout does not clear it. Never put this value in a URL or log. */
export const PRINT_PAIRING_TOKEN_KEY = "bravos.print-connector.token";

/** 32 bytes in base64url, without padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PROBE_KEY = "bravos.print-connector.storage-probe";
const DEFAULT_TIMEOUT_MS = 4_000;
/** Covers the native helper print bound and its read-only probe, still finite. */
const DEFAULT_POLL_BUDGET_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 300;

export const PRINT_WAIT_MESSAGE = "جارٍ إرسال الطباعة… يرجى الانتظار.";

type ConnectorPath = "/health" | "/pair" | "/status" | "/unpair" | "/jobs" | `/jobs/${string}`;

const PHASES = ["queued", "submitting", "submitted", "failed", "unknown"] as const;
type JobPhase = (typeof PHASES)[number];

export type ConnectorErrorCode =
  | "aborted"
  | "uncertain"
  | "offline"
  | "unpaired"
  | "unauthorized"
  | "layout"
  | "journal"
  | "driver"
  | "storage"
  | "pairing";

const ABORTED_MESSAGE = "أُلغيت الطباعة قبل الإرسال.";
const UNCERTAIN_MESSAGE = "لم يتأكد وصول الأمر إلى برنامج الطباعة. تحقق من الطابعة قبل إعادة الطباعة حتى لا تتكرر الورقة.";
const OFFLINE_MESSAGE = "برنامج الطباعة غير متاح على هذا الجهاز. لن تُستخدم نافذة المتصفح.";
const UNPAIRED_MESSAGE = "هذا المتصفح غير مربوط. اربط الجهاز مرة واحدة من الرئيسية، ثم استخدم زر الطباعة المعتاد.";
const LAYOUT_MESSAGE = "هذا المقاس أو المحتوى غير مدعوم على الطابعة المربوطة. لن يُصغَّر المستند ولن تُستخدم طابعة أخرى.";
const JOURNAL_MESSAGE = "تعذر حفظ أمر الطباعة في برنامج الطباعة. لم يُقبل الأمر. أعد المحاولة لاحقاً.";
const QUEUE_MESSAGE = "قائمة برنامج الطباعة ممتلئة. انتظر ثم أعد المحاولة. لم يُعد إرسال هذا الأمر.";
const STORAGE_MESSAGE = "تعذر حفظ الربط في المتصفح. أُلغي الربط في برنامج الطباعة حتى لا يبقى الجهاز مربوطاً بلا نسخة محفوظة.";
const STORAGE_STRANDED_MESSAGE = "تعذر حفظ الربط في المتصفح، وتعذر إلغاء الربط في برنامج الطباعة. الربط هناك ما زال قائماً. أعد ضبط الربط من برنامج الطباعة على هذا الجهاز، ثم اربط المتصفح مرة أخرى. إدخال الرمز مرة ثانية لا يستبدل ربطاً قائماً.";

export class ConnectorClientError extends Error {
  readonly code: ConnectorErrorCode;
  /** Existing connector `error` string. Null when this client classified the failure itself. */
  readonly connectorError: string | null;

  constructor(code: ConnectorErrorCode, message: string, connectorError: string | null = null) {
    super(message);
    this.name = "ConnectorClientError";
    this.code = code;
    this.connectorError = connectorError;
  }
}

export type ConnectorConnection =
  | { state: "offline"; pairedLocally: boolean }
  | { state: "unpaired"; connectorReachable: true }
  | { state: "origin-mismatch"; pairedLocally: boolean }
  | { state: "invalid-status"; pairedLocally: boolean }
  | {
      state: "paired";
      connectorReachable: true;
      /** False when the local program is up but cannot draw yet. Never means paper printed. */
      rendererReady: boolean;
      labelPrinter: typeof LABEL_PRINTER_NAME;
      receiptPrinter: typeof RECEIPT_PRINTER_NAME;
    };

type TokenStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ConnectorClientDeps = {
  fetchImpl?: typeof fetch;
  storage?: TokenStorage;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  pollBudgetMs?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** Page origin to compare with status. Defaults to the current page. */
  origin?: string;
};

type ResolvedDeps = {
  fetchImpl: typeof fetch;
  storage: TokenStorage;
  now: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  pollBudgetMs: number;
  pollIntervalMs: number;
  timeoutMs: number;
  origin: string;
};

function fail(code: ConnectorErrorCode, message: string, connectorError: string | null = null): ConnectorClientError {
  return new ConnectorClientError(code, message, connectorError);
}

function connectorErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "string" || error.length < 1 || error.length > 64) return null;
  return error;
}

function defaultStorage(): TokenStorage {
  if (typeof localStorage === "undefined") {
    throw fail("storage", STORAGE_MESSAGE);
  }
  return localStorage;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(fail("aborted", ABORTED_MESSAGE));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(fail("aborted", ABORTED_MESSAGE));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function resolveDeps(deps?: ConnectorClientDeps): ResolvedDeps {
  return {
    fetchImpl: deps?.fetchImpl ?? fetch.bind(globalThis),
    storage: deps?.storage ?? defaultStorage(),
    now: deps?.now ?? (() => Date.now()),
    sleep: deps?.sleep ?? defaultSleep,
    pollBudgetMs: deps?.pollBudgetMs ?? DEFAULT_POLL_BUDGET_MS,
    pollIntervalMs: deps?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    timeoutMs: deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    origin: deps?.origin ?? (typeof location !== "undefined" ? location.origin : ""),
  };
}

function endpoint(path: ConnectorPath): string {
  return `${PRINT_CONNECTOR_ORIGIN}${path}`;
}

export function normalizePairingCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function hasPairingToken(storage?: TokenStorage): boolean {
  return readToken(storage ?? defaultStorage()) !== null;
}

function readToken(storage: TokenStorage): string | null {
  const value = storage.getItem(PRINT_PAIRING_TOKEN_KEY);
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) return null;
  return value;
}

function assertStorageWritable(storage: TokenStorage): void {
  try {
    storage.setItem(PROBE_KEY, "1");
    storage.removeItem(PROBE_KEY);
  } catch {
    throw fail("storage", "تعذر حفظ الربط في هذا المتصفح. لم يُرسل رمز الربط.");
  }
}

function driverMessage(code: string | null): string | null {
  switch (code) {
    case "printer_missing":
      return "الطابعة غير مُضافة على هذا الجهاز. اطلب من المسؤول إعدادها.";
    case "printer_offline":
      return "الطابعة غير متصلة. تأكد من تشغيلها وتوصيل كابل USB، ثم أعد الطباعة.";
    case "unsupported_driver":
      return "تعذر استخدام تعريف الطابعة. اطلب من المسؤول مراجعة الإعداد.";
    case "renderer_unavailable":
      return "تعذر تجهيز الطباعة. أعد تشغيل برنامج الطباعة ثم حاول مرة أخرى.";
    case "unsupported_platform":
      return "برنامج الطباعة متاح على Windows فقط.";
    default:
      return null;
  }
}

function pairingMessage(status: number): string {
  if (status === 429) return "محاولات الربط كثيرة. انتظر قليلاً ثم أعد إدخال الرمز.";
  if (status === 500) return "تعذر حفظ الربط في برنامج الطباعة.";
  return "رمز الربط غير صحيح أو انتهت صلاحيته.";
}

type RequestMode = "read" | "submit" | "poll";

async function request(
  path: ConnectorPath,
  init: RequestInit,
  deps: ResolvedDeps,
  signal: AbortSignal | undefined,
  mode: RequestMode,
): Promise<Response> {
  if (signal?.aborted) {
    throw mode === "poll" ? fail("uncertain", UNCERTAIN_MESSAGE) : fail("aborted", ABORTED_MESSAGE);
  }
  const timeout = AbortSignal.timeout(deps.timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    return await deps.fetchImpl(endpoint(path), {
      ...init,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: combined,
    });
  } catch (error) {
    if (error instanceof ConnectorClientError) throw error;
    if (mode === "poll" || mode === "submit") throw fail("uncertain", UNCERTAIN_MESSAGE);
    if (signal?.aborted) throw fail("aborted", ABORTED_MESSAGE);
    throw fail("offline", OFFLINE_MESSAGE);
  }
}

async function connectorReachable(deps: ResolvedDeps, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await request("/health", { method: "GET" }, deps, signal, "read");
    if (!response.ok) return false;
    const body = await readJson(response);
    return Boolean(body && typeof body === "object" && (body as { ok?: unknown }).ok === true);
  } catch (error) {
    if (error instanceof ConnectorClientError && error.code === "aborted") throw error;
    return false;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

function bearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function readMeta(value: unknown, id: string): { phase: JobPhase; failureCode: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const job = (value as { job?: unknown }).job;
  if (!job || typeof job !== "object") return null;
  const record = job as Record<string, unknown>;
  if (record.id !== id || typeof record.phase !== "string" || !PHASES.includes(record.phase as JobPhase)) return null;
  if (record.failureCode !== null && typeof record.failureCode !== "string") return null;
  return { phase: record.phase as JobPhase, failureCode: record.failureCode ?? null };
}

function outcomeError(phase: JobPhase, failureCode: string | null): ConnectorClientError | null {
  if (phase === "submitted") return null;
  if (phase === "failed") {
    if (failureCode === "journal_unavailable") return fail("journal", JOURNAL_MESSAGE);
    const driver = driverMessage(failureCode);
    if (driver) return fail("driver", driver);
    return fail("uncertain", UNCERTAIN_MESSAGE);
  }
  return fail("uncertain", UNCERTAIN_MESSAGE);
}

async function forgetRejectedToken(storage: TokenStorage): Promise<void> {
  try {
    storage.removeItem(PRINT_PAIRING_TOKEN_KEY);
  } catch {
    // The server already rejected the token. A blocked store is surfaced on the next action.
  }
}

export async function pairDevice(rawCode: string, options?: { signal?: AbortSignal; deps?: ConnectorClientDeps }): Promise<void> {
  const deps = resolveDeps(options?.deps);
  const code = normalizePairingCode(rawCode);
  if (code.length !== PAIRING_CODE_LENGTH) {
    throw fail("pairing", "رمز الربط غير مكتمل.");
  }
  assertStorageWritable(deps.storage);
  const response = await request("/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  }, deps, options?.signal, "read");
  const body = await readJson(response);
  if (!response.ok) throw fail("pairing", pairingMessage(response.status));
  const token = body && typeof body === "object" ? (body as { token?: unknown }).token : null;
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    throw fail("pairing", "تعذر إتمام الربط. أعد إدخال الرمز.");
  }
  try {
    deps.storage.setItem(PRINT_PAIRING_TOKEN_KEY, token);
  } catch {
    await revokeIssuedToken(token, deps, options?.signal);
  }
}

async function revokeIssuedToken(token: string, deps: ResolvedDeps, signal: AbortSignal | undefined): Promise<never> {
  try {
    deps.storage.removeItem(PRINT_PAIRING_TOKEN_KEY);
  } catch {
    // The new token never became readable. Revoke the server record below.
  }
  try {
    const response = await request("/unpair", { method: "POST", headers: bearer(token) }, deps, signal, "read");
    if (!response.ok) throw fail("storage", STORAGE_STRANDED_MESSAGE);
  } catch (error) {
    if (error instanceof ConnectorClientError && error.code === "storage") throw error;
    throw fail("storage", STORAGE_STRANDED_MESSAGE);
  }
  throw fail("storage", STORAGE_MESSAGE);
}

export async function unpairDevice(options?: { signal?: AbortSignal; deps?: ConnectorClientDeps }): Promise<void> {
  const deps = resolveDeps(options?.deps);
  const token = readToken(deps.storage);
  if (!token) {
    try {
      deps.storage.removeItem(PRINT_PAIRING_TOKEN_KEY);
    } catch {
      // Nothing usable was stored.
    }
    return;
  }
  const response = await request("/unpair", { method: "POST", headers: bearer(token) }, deps, options?.signal, "read");
  if (response.status === 401 || response.ok) {
    await forgetRejectedToken(deps.storage);
    if (!response.ok) throw fail("unauthorized", UNPAIRED_MESSAGE);
    return;
  }
  throw fail("offline", "تعذر إلغاء الربط لأن برنامج الطباعة غير متاح. الربط ما زال محفوظاً على هذا المتصفح.");
}

export async function readConnectorConnection(options?: { signal?: AbortSignal; deps?: ConnectorClientDeps }): Promise<ConnectorConnection> {
  const deps = resolveDeps(options?.deps);
  const token = readToken(deps.storage);
  const reachable = await connectorReachable(deps, options?.signal);
  if (!reachable) return { state: "offline", pairedLocally: token !== null };
  if (!token) return { state: "unpaired", connectorReachable: true };
  const response = await request("/status", { method: "GET", headers: bearer(token) }, deps, options?.signal, "read");
  if (response.status === 401) {
    await forgetRejectedToken(deps.storage);
    return { state: "unpaired", connectorReachable: true };
  }
  if (!response.ok) return { state: "offline", pairedLocally: true };
  const status = interpretStatus(await readJson(response), deps.origin);
  if (status.kind === "unpaired") {
    await forgetRejectedToken(deps.storage);
    return { state: "unpaired", connectorReachable: true };
  }
  if (status.kind === "mismatch") return { state: "origin-mismatch", pairedLocally: true };
  if (status.kind === "invalid") return { state: "invalid-status", pairedLocally: true };
  return {
    state: "paired",
    connectorReachable: true,
    rendererReady: status.rendererReady,
    labelPrinter: LABEL_PRINTER_NAME,
    receiptPrinter: RECEIPT_PRINTER_NAME,
  };
}

type StatusReading =
  | { kind: "unpaired" }
  | { kind: "mismatch" }
  | { kind: "invalid" }
  | { kind: "paired"; rendererReady: boolean };

/** A 200 body is paired only when every fixed field matches. Routing text is not a live printer probe. */
function interpretStatus(body: unknown, origin: string): StatusReading {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { kind: "invalid" };
  const record = body as Record<string, unknown>;
  if (record.ok !== true) return { kind: "invalid" };
  if (typeof record.staffOrigin !== "string" || typeof record.paired !== "boolean") return { kind: "invalid" };
  if (record.staffOrigin !== origin) return { kind: "mismatch" };
  if (!record.paired) return { kind: "unpaired" };
  const routing = record.routing;
  if (!routing || typeof routing !== "object" || Array.isArray(routing)) return { kind: "invalid" };
  const names = routing as Record<string, unknown>;
  if (names.label !== LABEL_PRINTER_NAME || names.receipt !== RECEIPT_PRINTER_NAME) return { kind: "invalid" };
  if (record.implementation === "injected" || record.implementation === "windows_native") {
    return { kind: "paired", rendererReady: true };
  }
  if (record.implementation === "windows_fail_closed") return { kind: "paired", rendererReady: false };
  return { kind: "invalid" };
}

/**
 * Posts one already-built job. A lost response is never posted again.
 * `submitted` means the connector accepted spooler handoff, not paper output.
 */
export async function submitConnectorJob(
  job: unknown,
  options?: { signal?: AbortSignal; deps?: ConnectorClientDeps; onProgress?: (message: string) => void },
): Promise<"submitted"> {
  const deps = resolveDeps(options?.deps);
  const parsed = parsePrintJob(job);
  if (!parsed) throw fail("layout", LAYOUT_MESSAGE);
  const token = readToken(deps.storage);
  if (!token) throw fail("unpaired", UNPAIRED_MESSAGE);
  if (options?.signal?.aborted) throw fail("aborted", ABORTED_MESSAGE);
  const response = await request("/jobs", {
    method: "POST",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: JSON.stringify(parsed),
  }, deps, options?.signal, "submit");
  if (response.status === 401) {
    await forgetRejectedToken(deps.storage);
    throw fail("unpaired", UNPAIRED_MESSAGE);
  }
  if (response.status === 400 || response.status === 413 || response.status === 415) {
    throw fail("layout", LAYOUT_MESSAGE, connectorErrorCode(await readJson(response)));
  }
  if (response.status === 500) throw fail("journal", JOURNAL_MESSAGE);
  if (response.status === 429) throw fail("journal", QUEUE_MESSAGE);
  if (response.status === 409 || !response.ok) throw fail("uncertain", UNCERTAIN_MESSAGE);
  const meta = readMeta(await readJson(response), parsed.id);
  if (!meta) throw fail("uncertain", UNCERTAIN_MESSAGE);
  return waitForTerminal(parsed.id, token, meta, deps, options?.signal, options?.onProgress);
}

async function waitForTerminal(
  id: string,
  token: string,
  meta: { phase: JobPhase; failureCode: string | null },
  deps: ResolvedDeps,
  signal: AbortSignal | undefined,
  onProgress: ((message: string) => void) | undefined,
): Promise<"submitted"> {
  let phase = meta.phase;
  let failureCode = meta.failureCode;
  const started = deps.now();
  const maxPolls = Math.max(1, Math.ceil(deps.pollBudgetMs / Math.max(deps.pollIntervalMs, 1))) + 1;
  let polls = 0;
  while (phase === "queued" || phase === "submitting") {
    if (deps.now() - started >= deps.pollBudgetMs || polls >= maxPolls) throw fail("uncertain", UNCERTAIN_MESSAGE);
    polls += 1;
    onProgress?.(PRINT_WAIT_MESSAGE);
    try {
      await deps.sleep(deps.pollIntervalMs, signal ?? new AbortController().signal);
    } catch {
      throw fail("uncertain", UNCERTAIN_MESSAGE);
    }
    const response = await request(
      `/jobs/${id}`,
      { method: "GET", headers: bearer(token) },
      deps,
      signal,
      "poll",
    );
    if (response.status === 404 || response.status === 409 || !response.ok) throw fail("uncertain", UNCERTAIN_MESSAGE);
    const next = readMeta(await readJson(response), id);
    if (!next) throw fail("uncertain", UNCERTAIN_MESSAGE);
    phase = next.phase;
    failureCode = next.failureCode;
  }
  const error = outcomeError(phase, failureCode);
  if (error) throw error;
  return "submitted";
}

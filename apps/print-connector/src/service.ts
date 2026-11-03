import { randomBytes as nodeRandomBytes } from "./token-hash.ts";
import {
  JOB_METADATA_CAP,
  JOB_RETENTION_MS,
  LABEL_PRINTER_NAME,
  PAIRING_CODE_LENGTH,
  PAIRING_LOCK_MS,
  PAIRING_MAX_ATTEMPTS,
  PAIRING_TTL_MS,
  PRINT_CONNECTOR_HOST,
  QUEUE_CAP,
  RECEIPT_PRINTER_NAME,
  type PrintJob,
} from "./contracts.ts";
import { beginSubmit, finishJob, isOutstanding, queuedMeta } from "./domain/jobs.ts";
import { pairingCodeFromBytes } from "./domain/pairing.ts";
import { normalizePortResult } from "./domain/print-result.ts";
import { routeJob } from "./domain/routing.ts";
import type {
  JobJournal,
  JobMeta,
  JournalRecord,
  LocalNotice,
  PrintPort,
  PrintPortResult,
  SanitizedEvent,
  StoredPairing,
  TokenStore,
} from "./ports.ts";
import { codeMatches, sha256Hex, tokenMatches } from "./token-hash.ts";

type LiveJob = {
  hash: string;
  meta: JobMeta;
  document: PrintJob | null;
};

type ClaimedJob =
  | { kind: "empty" }
  | { kind: "skipped" }
  | { kind: "ready"; id: string; dispatch: Parameters<PrintPort["submit"]>[0] };

export type SubmitResult =
  | { type: "accepted"; meta: JobMeta }
  | { type: "existing"; meta: JobMeta }
  | { type: "conflict" }
  | { type: "queue_full" }
  | { type: "retention_full" }
  | { type: "storage_failed" };

export type PairResult =
  | { ok: true; token: string }
  | {
    ok: false;
    error: "invalid_origin" | "pairing_invalid" | "pairing_expired" | "pairing_rate_limited" | "pairing_store_failed";
  };

export type ConnectorStatus = {
  ok: true;
  paired: boolean;
  staffOrigin: string;
  listen: { host: typeof PRINT_CONNECTOR_HOST; port: number };
  routing: { label: typeof LABEL_PRINTER_NAME; receipt: typeof RECEIPT_PRINTER_NAME };
  implementation: ReturnType<PrintPort["describe"]>["implementation"];
  queue: { outstanding: number; cap: number; retained: number; metadataCap: number; retentionMs: number };
};

export type ConnectorService = {
  pair(origin: string, code: string): Promise<PairResult>;
  unpair(origin: string, token: string | null): Promise<boolean>;
  authorize(origin: string, token: string | null): boolean;
  submit(job: PrintJob): Promise<SubmitResult>;
  job(id: string): JobMeta | null;
  status(listenPort: number): ConnectorStatus;
  waitUntilIdle(): Promise<void>;
  holdsDocument(id: string): boolean;
};

export type ServiceDeps = {
  printPort: PrintPort;
  tokenStore: TokenStore;
  journal: JobJournal;
  staffOrigin: string;
  now: () => number;
  randomBytes: (size: number) => Uint8Array;
  localNotice: (notice: LocalNotice) => void;
  log: (event: SanitizedEvent) => void;
  queueCap: number;
  metadataCap: number;
  retentionMs: number;
};

function stamped(now: number): string {
  if (!Number.isFinite(now)) throw new Error("invalid_clock");
  return new Date(now).toISOString();
}

function emit(input: {
  event: SanitizedEvent["event"];
  httpStatus?: number | null;
  jobId?: string | null;
  kind?: "label" | "receipt" | null;
  phase?: string | null;
  failureCode?: string | null;
  error?: string | null;
}): SanitizedEvent {
  return {
    event: input.event,
    httpStatus: input.httpStatus ?? null,
    jobId: input.jobId ?? null,
    kind: input.kind ?? null,
    phase: input.phase ?? null,
    failureCode: input.failureCode ?? null,
    error: input.error ?? null,
  };
}

export function publicMeta(meta: JobMeta): JobMeta {
  return {
    id: meta.id,
    kind: meta.kind,
    phase: meta.phase,
    failureCode: meta.failureCode,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

function journalRecord(live: LiveJob): JournalRecord {
  return {
    id: live.meta.id,
    hash: live.hash,
    kind: live.meta.kind,
    phase: live.meta.phase,
    failureCode: live.meta.failureCode,
    createdAt: live.meta.createdAt,
    updatedAt: live.meta.updatedAt,
  };
}

function metaFrom(record: JournalRecord): JobMeta {
  return {
    id: record.id,
    kind: record.kind,
    phase: record.phase,
    failureCode: record.failureCode,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function recoverOutstanding(record: JournalRecord, nowIso: string): JournalRecord {
  if (record.phase !== "queued" && record.phase !== "submitting") return record;
  return {
    ...record,
    phase: "unknown",
    failureCode: "submission_uncertain",
    updatedAt: nowIso,
  };
}

function isExpired(record: Pick<JournalRecord, "phase" | "updatedAt">, now: number, retentionMs: number): boolean {
  if (record.phase === "queued" || record.phase === "submitting") return false;
  const updated = Date.parse(record.updatedAt);
  if (!Number.isFinite(updated)) return false;
  return now - updated >= retentionMs;
}

export async function createConnectorService(deps: ServiceDeps): Promise<ConnectorService> {
  const jobs = new Map<string, LiveJob>();
  const queue: string[] = [];
  let record: StoredPairing | null = null;
  let codeHash: string | null = null;
  let codeExpiresAt: number | null = null;
  let attempts = 0;
  let lockedUntil: number | null = null;
  let pumping = false;
  let chain: Promise<void> = Promise.resolve();
  const idleWaiters: Array<() => void> = [];

  function issueCode(): void {
    const code = pairingCodeFromBytes(deps.randomBytes(PAIRING_CODE_LENGTH));
    const now = deps.now();
    codeHash = sha256Hex(code);
    codeExpiresAt = now + PAIRING_TTL_MS;
    attempts = 0;
    deps.localNotice({ type: "pairing_code", code, expiresAt: codeExpiresAt });
  }

  function hasQueued(): boolean {
    return queue.some((id) => jobs.get(id)?.meta.phase === "queued");
  }

  function flushIdle(): void {
    if (pumping || hasQueued()) return;
    const waiters = idleWaiters.splice(0);
    for (const waiter of waiters) waiter();
  }

  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  function authorizes(origin: string, token: string | null): boolean {
    const storedHash = record?.tokenSha256Hex ?? null;
    const matches = tokenMatches(storedHash, token);
    return record !== null && origin === deps.staffOrigin && record.origin === origin && matches;
  }

  function claimNext(): { id: string; dispatch: Parameters<PrintPort["submit"]>[0] } | null {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) return null;
      const live = jobs.get(id);
      if (!live || live.meta.phase !== "queued" || !live.document) continue;
      live.meta = beginSubmit(live.meta, stamped(deps.now()));
      const route = routeJob(live.document);
      return {
        id,
        dispatch: {
          jobId: live.meta.id,
          kind: live.document.kind,
          printerName: route.printerName,
          copies: live.document.copies,
          document: live.document,
        },
      };
    }
    return null;
  }

  async function claimAndPersist(): Promise<ClaimedJob> {
    const next = claimNext();
    if (!next) return { kind: "empty" };
    const live = jobs.get(next.id);
    if (!live) return { kind: "skipped" };
    try {
      await deps.journal.save(journalRecord(live));
      return { kind: "ready", id: next.id, dispatch: next.dispatch };
    } catch {
      live.meta = {
        ...live.meta,
        phase: "failed",
        failureCode: "journal_unavailable",
        updatedAt: stamped(deps.now()),
      };
      live.document = null;
      try {
        await deps.journal.save(journalRecord(live));
      } catch {
        // The queued record remains on disk and restarts as unknown. Do not submit.
      }
      deps.log(emit({
        event: "job_finished",
        jobId: live.meta.id,
        kind: live.meta.kind,
        phase: live.meta.phase,
        failureCode: live.meta.failureCode,
      }));
      return { kind: "skipped" };
    }
  }

  async function finishAndPersist(id: string, result: PrintPortResult): Promise<void> {
    const live = jobs.get(id);
    if (!live) return;
    live.meta = finishJob(live.meta, result, stamped(deps.now()));
    live.document = null;
    try {
      await deps.journal.save(journalRecord(live));
    } catch {
      live.meta = {
        ...live.meta,
        phase: "unknown",
        failureCode: "submission_uncertain",
        updatedAt: stamped(deps.now()),
      };
      try {
        await deps.journal.save(journalRecord(live));
      } catch {
        // Memory stays unknown so this process does not submit the id again.
      }
    }
    deps.log(emit({
      event: "job_finished",
      jobId: live.meta.id,
      kind: live.meta.kind,
      phase: live.meta.phase,
      failureCode: live.meta.failureCode,
    }));
  }

  async function pump(): Promise<void> {
    try {
      for (;;) {
        const next = await exclusive(() => claimAndPersist());
        if (next.kind === "empty") break;
        if (next.kind === "skipped") continue;
        let result: PrintPortResult;
        try {
          result = normalizePortResult(await deps.printPort.submit(next.dispatch));
        } catch {
          result = { outcome: "unknown" };
        }
        await exclusive(() => finishAndPersist(next.id, result));
      }
    } finally {
      pumping = false;
      if (hasQueued()) schedule();
      else flushIdle();
    }
  }

  function schedule(): void {
    if (pumping || !hasQueued()) return;
    pumping = true;
    void pump();
  }

  function replaceJobs(retained: LiveJob[]): void {
    jobs.clear();
    for (const live of retained) jobs.set(live.meta.id, live);
  }

  const loaded = await deps.journal.load();
  const startedAt = stamped(deps.now());
  let journalChanged = false;
  const recovered = loaded.map((item) => {
    const next = recoverOutstanding(item, startedAt);
    if (next.phase !== item.phase || next.failureCode !== item.failureCode || next.updatedAt !== item.updatedAt) {
      journalChanged = true;
    }
    return next;
  });
  const kept = recovered.filter((item) => !isExpired(item, deps.now(), deps.retentionMs));
  if (kept.length !== recovered.length) journalChanged = true;
  if (journalChanged) await deps.journal.saveAll(kept);
  for (const item of kept) {
    jobs.set(item.id, { hash: item.hash, meta: metaFrom(item), document: null });
  }

  const stored = await deps.tokenStore.read();
  if (stored && stored.origin === deps.staffOrigin) {
    record = stored;
  } else if (stored) {
    await deps.tokenStore.clear();
    issueCode();
  } else {
    issueCode();
  }

  return {
    async pair(origin, code) {
      return exclusive(async () => {
        if (origin !== deps.staffOrigin) return { ok: false, error: "invalid_origin" };
        if (record) return { ok: false, error: "pairing_invalid" };
        const now = deps.now();
        if (lockedUntil !== null && now < lockedUntil) return { ok: false, error: "pairing_rate_limited" };
        if (lockedUntil !== null) lockedUntil = null;
        if (codeHash === null || codeExpiresAt === null || now >= codeExpiresAt) {
          issueCode();
          return { ok: false, error: "pairing_expired" };
        }
        if (!codeMatches(codeHash, code)) {
          attempts += 1;
          if (attempts >= PAIRING_MAX_ATTEMPTS) {
            attempts = 0;
            lockedUntil = now + PAIRING_LOCK_MS;
            return { ok: false, error: "pairing_rate_limited" };
          }
          return { ok: false, error: "pairing_invalid" };
        }
        const token = nodeRandomBytes(32).toString("base64url");
        const next: StoredPairing = {
          version: 1,
          tokenSha256Hex: sha256Hex(token),
          origin,
          pairedAt: stamped(now),
        };
        try {
          await deps.tokenStore.write(next);
        } catch {
          return { ok: false, error: "pairing_store_failed" };
        }
        record = next;
        codeHash = null;
        codeExpiresAt = null;
        attempts = 0;
        deps.log(emit({ event: "paired" }));
        return { ok: true, token };
      });
    },
    async unpair(origin, token) {
      return exclusive(async () => {
        if (!authorizes(origin, token)) return false;
        await deps.tokenStore.clear();
        record = null;
        issueCode();
        deps.log(emit({ event: "unpaired" }));
        return true;
      });
    },
    authorize(origin, token) {
      return authorizes(origin, token);
    },
    submit(job) {
      return exclusive(async () => {
        const hash = sha256Hex(JSON.stringify(job));
        const existing = jobs.get(job.id);
        if (existing) {
          if (existing.hash !== hash) return { type: "conflict" };
          return { type: "existing", meta: publicMeta(existing.meta) };
        }
        const now = deps.now();
        const retained: LiveJob[] = [];
        let pruned = false;
        for (const live of jobs.values()) {
          if (isExpired(live.meta, now, deps.retentionMs)) pruned = true;
          else retained.push(live);
        }
        if (retained.length >= deps.metadataCap) {
          if (pruned) {
            try {
              await deps.journal.saveAll(retained.map((live) => journalRecord(live)));
            } catch {
              return { type: "storage_failed" };
            }
            replaceJobs(retained);
          }
          return { type: "retention_full" };
        }
        let outstanding = 0;
        for (const live of retained) {
          if (isOutstanding(live.meta)) outstanding += 1;
        }
        if (outstanding >= deps.queueCap) {
          if (pruned) {
            try {
              await deps.journal.saveAll(retained.map((live) => journalRecord(live)));
            } catch {
              return { type: "storage_failed" };
            }
            replaceJobs(retained);
          }
          return { type: "queue_full" };
        }
        const meta = queuedMeta(job, stamped(now));
        const live: LiveJob = { hash, meta, document: job };
        try {
          await deps.journal.saveAll([...retained.map((item) => journalRecord(item)), journalRecord(live)]);
        } catch {
          return { type: "storage_failed" };
        }
        if (pruned) replaceJobs(retained);
        jobs.set(job.id, live);
        queue.push(job.id);
        schedule();
        return { type: "accepted", meta: publicMeta(live.meta) };
      });
    },
    job(id) {
      const live = jobs.get(id);
      return live ? publicMeta(live.meta) : null;
    },
    status(listenPort) {
      let outstanding = 0;
      for (const live of jobs.values()) {
        if (isOutstanding(live.meta)) outstanding += 1;
      }
      return {
        ok: true,
        paired: record !== null,
        staffOrigin: deps.staffOrigin,
        listen: { host: PRINT_CONNECTOR_HOST, port: listenPort },
        routing: { label: LABEL_PRINTER_NAME, receipt: RECEIPT_PRINTER_NAME },
        implementation: deps.printPort.describe().implementation,
        queue: {
          outstanding,
          cap: deps.queueCap,
          retained: jobs.size,
          metadataCap: deps.metadataCap,
          retentionMs: deps.retentionMs,
        },
      };
    },
    waitUntilIdle() {
      if (!pumping && !hasQueued()) return Promise.resolve();
      return new Promise((resolve) => {
        idleWaiters.push(resolve);
      });
    },
    holdsDocument(id) {
      return jobs.get(id)?.document != null;
    },
  };
}

export function defaultRandomBytes(size: number): Uint8Array {
  return nodeRandomBytes(size);
}

export const DEFAULT_QUEUE_CAP = QUEUE_CAP;
export const DEFAULT_METADATA_CAP = JOB_METADATA_CAP;
export const DEFAULT_RETENTION_MS = JOB_RETENTION_MS;

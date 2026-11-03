import { LABEL_PRINTER_NAME, RECEIPT_PRINTER_NAME, type PrintJob } from "./contracts.ts";

export type PrintFailureCode =
  | "printer_missing"
  | "printer_offline"
  | "unsupported_driver"
  | "renderer_unavailable"
  | "unsupported_platform"
  | "invalid_layout"
  | "invalid_job";

export type PrintPortResult =
  | { outcome: "submitted" }
  | { outcome: "failed"; code: PrintFailureCode }
  | { outcome: "unknown" };

export type PrintDispatch = {
  jobId: string;
  kind: "label" | "receipt";
  printerName: typeof LABEL_PRINTER_NAME | typeof RECEIPT_PRINTER_NAME;
  copies: number;
  document: PrintJob;
};

export type PrintPort = {
  describe(): { implementation: "windows_fail_closed" | "windows_native" | "injected" };
  submit(dispatch: PrintDispatch): Promise<PrintPortResult>;
};

export type StoredPairing = {
  version: 1;
  tokenSha256Hex: string;
  origin: string;
  pairedAt: string;
};

export type TokenStore = {
  read(): Promise<StoredPairing | null>;
  write(record: StoredPairing): Promise<void>;
  clear(): Promise<void>;
};

export type LocalNotice = {
  type: "pairing_code";
  code: string;
  expiresAt: number;
};

export type SanitizedEventName =
  | "listen"
  | "rejected"
  | "paired"
  | "unpaired"
  | "job_accepted"
  | "job_finished";

export type SanitizedEvent = {
  event: SanitizedEventName;
  httpStatus: number | null;
  jobId: string | null;
  kind: "label" | "receipt" | null;
  phase: string | null;
  failureCode: string | null;
  error: string | null;
};

export type JobPhase = "queued" | "submitting" | "submitted" | "failed" | "unknown";

export type JobMeta = {
  id: string;
  kind: "label" | "receipt";
  phase: JobPhase;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Sanitized dedupe record. Payload, token, and customer text are not fields. */
export type JournalRecord = {
  id: string;
  hash: string;
  kind: "label" | "receipt";
  phase: JobPhase;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobJournal = {
  load(): Promise<JournalRecord[]>;
  save(record: JournalRecord): Promise<void>;
  saveAll(records: JournalRecord[]): Promise<void>;
};

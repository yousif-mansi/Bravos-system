import type { JournalRecord } from "../ports.ts";

const KEYS = ["id", "hash", "kind", "phase", "failureCode", "createdAt", "updatedAt"] as const;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FAILURE = /^[a-z0-9_]{1,40}$/;

export function copyJournalRecord(record: JournalRecord): JournalRecord {
  return {
    id: record.id,
    hash: record.hash,
    kind: record.kind,
    phase: record.phase,
    failureCode: record.failureCode,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function parseJournalRecord(value: unknown): JournalRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== KEYS.length || KEYS.some((key) => !Object.prototype.hasOwnProperty.call(record, key))) return null;
  const id = record.id;
  const hash = record.hash;
  const kind = record.kind;
  const phase = record.phase;
  const failureCode = record.failureCode;
  const createdAt = record.createdAt;
  const updatedAt = record.updatedAt;
  if (typeof id !== "string" || !ID.test(id)) return null;
  if (typeof hash !== "string" || !HASH.test(hash)) return null;
  if (kind !== "label" && kind !== "receipt") return null;
  if (phase !== "queued" && phase !== "submitting" && phase !== "submitted" && phase !== "failed" && phase !== "unknown") return null;
  let storedFailure: string | null;
  if (failureCode === null) storedFailure = null;
  else if (typeof failureCode === "string" && FAILURE.test(failureCode)) storedFailure = failureCode;
  else return null;
  if (typeof createdAt !== "string" || !ISO.test(createdAt)) return null;
  if (typeof updatedAt !== "string" || !ISO.test(updatedAt)) return null;
  return { id, hash, kind, phase, failureCode: storedFailure, createdAt, updatedAt };
}

export function serializeJournal(records: readonly JournalRecord[]): Buffer {
  const body = {
    version: 1,
    records: records.map((record) => copyJournalRecord(record)),
  };
  return Buffer.from(JSON.stringify(body), "utf8");
}

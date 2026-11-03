import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { JOB_METADATA_CAP } from "../contracts.ts";
import { copyJournalRecord, parseJournalRecord, serializeJournal } from "../domain/journal-record.ts";
import type { JobJournal, JournalRecord } from "../ports.ts";

const FINAL_SUFFIX = "\\Bravos\\print-connector\\job-journal.json";
const PARTIAL_SUFFIX = "\\Bravos\\print-connector\\job-journal.json.partial";
const BACKUP_SUFFIX = "\\Bravos\\print-connector\\job-journal.json.bak";
const MAX_FILE_BYTES = 32 * 1024 * 1024;

export type JournalFiles = {
  read(file: string): Promise<Buffer | null>;
  write(file: string, bytes: Buffer): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(file: string): Promise<void>;
};

type JournalKind = "final" | "partial" | "backup";

export function jobJournalPath(localAppData: string): string {
  return `${localAppDataRoot(localAppData)}${FINAL_SUFFIX}`;
}

function localAppDataRoot(localAppData: string): string {
  const trimmed = localAppData.replace(/[\\/]+$/, "");
  if (!/^[A-Za-z]:\\/.test(trimmed) || trimmed.split(/[\\/]/).includes("..")) {
    throw new Error("refusing_blob_path");
  }
  if (!/^[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+$/.test(trimmed)) {
    throw new Error("refusing_blob_path");
  }
  return trimmed;
}

export function assertOwnedJournal(file: string, kind: JournalKind): void {
  const normalized = file.replaceAll("/", "\\");
  const suffix = kind === "partial" ? PARTIAL_SUFFIX : kind === "backup" ? BACKUP_SUFFIX : FINAL_SUFFIX;
  if (!/^[A-Za-z]:\\/.test(normalized) || normalized.includes("..") || !normalized.endsWith(suffix)) {
    throw new Error("refusing_blob_path");
  }
}

function nodeJournalFiles(): JournalFiles {
  return {
    async read(file) {
      assertOwnedJournal(file, file.endsWith(".partial") ? "partial" : file.endsWith(".bak") ? "backup" : "final");
      try {
        return await readFile(file);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
        throw error;
      }
    },
    async write(file, bytes) {
      assertOwnedJournal(file, "partial");
      await mkdir(path.win32.dirname(file), { recursive: true });
      await writeFile(file, bytes, { flag: "w", flush: true });
    },
    async rename(from, to) {
      const fromKind = from.endsWith(".partial") ? "partial" : from.endsWith(".bak") ? "backup" : "final";
      const toKind = to.endsWith(".partial") ? "partial" : to.endsWith(".bak") ? "backup" : "final";
      assertOwnedJournal(from, fromKind);
      assertOwnedJournal(to, toKind);
      await rename(from, to);
    },
    async remove(file) {
      const kind = file.endsWith(".partial") ? "partial" : file.endsWith(".bak") ? "backup" : "final";
      assertOwnedJournal(file, kind);
      await rm(file, { force: true });
    },
  };
}

function parseFile(bytes: Buffer): JournalRecord[] {
  if (bytes.length < 1 || bytes.length > MAX_FILE_BYTES) throw new Error("journal_unavailable");
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("journal_unavailable");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("journal_unavailable");
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.length !== 2 || body.version !== 1 || !Array.isArray(body.records)) throw new Error("journal_unavailable");
  if (body.records.length > JOB_METADATA_CAP) throw new Error("journal_unavailable");
  const records: JournalRecord[] = [];
  const seen = new Set<string>();
  for (const item of body.records) {
    const record = parseJournalRecord(item);
    if (!record || seen.has(record.id)) throw new Error("journal_unavailable");
    seen.add(record.id);
    records.push(record);
  }
  return records;
}

async function replaceFile(finalPath: string, bytes: Buffer, files: JournalFiles): Promise<void> {
  const partial = `${finalPath}.partial`;
  const backup = `${finalPath}.bak`;
  assertOwnedJournal(finalPath, "final");
  assertOwnedJournal(partial, "partial");
  assertOwnedJournal(backup, "backup");
  await files.write(partial, bytes);
  try {
    const existing = await files.read(finalPath);
    if (existing !== null) {
      await files.remove(backup);
      await files.rename(finalPath, backup);
    }
    await files.rename(partial, finalPath);
    await files.remove(backup);
  } catch (error) {
    await files.remove(partial).catch(() => undefined);
    throw error;
  }
}

export function createWindowsJobJournal(options: {
  platform?: string;
  localAppData?: string;
  files?: JournalFiles;
} = {}): JobJournal {
  const platform = options.platform ?? process.platform;
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA ?? "";
  const files = options.files ?? nodeJournalFiles();
  let loaded: JournalRecord[] | null = null;

  function requireWindows(): string {
    if (platform !== "win32") throw new Error("unsupported_platform");
    return jobJournalPath(localAppData);
  }

  async function readOwned(): Promise<JournalRecord[]> {
    const finalPath = requireWindows();
    const finalBytes = await files.read(finalPath);
    if (finalBytes) return parseFile(finalBytes);
    const backup = await files.read(`${finalPath}.bak`);
    if (!backup) return [];
    return parseFile(backup);
  }

  async function ensure(): Promise<JournalRecord[]> {
    if (!loaded) loaded = await readOwned();
    return loaded;
  }

  async function commit(records: JournalRecord[]): Promise<void> {
    const copies = records.map((record) => copyJournalRecord(record));
    const seen = new Set<string>();
    for (const record of copies) {
      if (seen.has(record.id)) throw new Error("journal_unavailable");
      seen.add(record.id);
    }
    if (copies.length > JOB_METADATA_CAP) throw new Error("journal_unavailable");
    await replaceFile(requireWindows(), serializeJournal(copies), files);
    loaded = copies;
  }

  return {
    async load() {
      return (await ensure()).map((record) => copyJournalRecord(record));
    },
    async save(record) {
      const current = await ensure();
      const next = current.filter((item) => item.id !== record.id);
      next.push(copyJournalRecord(record));
      await commit(next);
    },
    async saveAll(records) {
      await commit(records);
    },
  };
}

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertStaffOrigin } from "../contracts.ts";
import type { StoredPairing, TokenStore } from "../ports.ts";
import {
  defaultHelperPath,
  dpapiStdin,
  planOwnedHelperSpawn,
  runOwnedHelper,
  type HelperRunner,
} from "./owned-helper.ts";

const FINAL_SUFFIX = "\\Bravos\\print-connector\\pairing.dpapi";
const PARTIAL_SUFFIX = "\\Bravos\\print-connector\\pairing.dpapi.partial";

export type BlobFiles = {
  read(file: string): Promise<Buffer | null>;
  write(file: string, bytes: Buffer): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(file: string): Promise<void>;
};

export function pairingBlobPath(localAppData: string): string {
  const trimmed = localAppData.replace(/[\\/]+$/, "");
  if (!/^[A-Za-z]:\\/.test(trimmed) || trimmed.split(/[\\/]/).includes("..")) {
    throw new Error("refusing_blob_path");
  }
  if (!/^[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+$/.test(trimmed)) {
    throw new Error("refusing_blob_path");
  }
  return `${trimmed}${FINAL_SUFFIX}`;
}

export function assertOwnedBlob(file: string, partial = false): void {
  const normalized = file.replaceAll("/", "\\");
  const suffix = partial ? PARTIAL_SUFFIX : FINAL_SUFFIX;
  if (!/^[A-Za-z]:\\/.test(normalized) || normalized.includes("..") || !normalized.endsWith(suffix)) {
    throw new Error("refusing_blob_path");
  }
}

function nodeBlobFiles(): BlobFiles {
  return {
    async read(file) {
      assertOwnedBlob(file);
      try {
        return await readFile(file);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
        throw error;
      }
    },
    async write(file, bytes) {
      assertOwnedBlob(file, true);
      await mkdir(path.win32.dirname(file), { recursive: true });
      await writeFile(file, bytes, { flag: "w" });
    },
    async rename(from, to) {
      assertOwnedBlob(from, true);
      assertOwnedBlob(to);
      await rename(from, to);
    },
    async remove(file) {
      const partial = file.endsWith(".partial");
      assertOwnedBlob(file, partial);
      await rm(file, { force: true });
    },
  };
}

function parseStored(bytes: Buffer): StoredPairing {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("dpapi_failed");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("dpapi_failed");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 4 || record.version !== 1) throw new Error("dpapi_failed");
  if (typeof record.tokenSha256Hex !== "string" || !/^[0-9a-f]{64}$/.test(record.tokenSha256Hex)) {
    throw new Error("dpapi_failed");
  }
  if (typeof record.origin !== "string" || typeof record.pairedAt !== "string") throw new Error("dpapi_failed");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.pairedAt)) throw new Error("dpapi_failed");
  let origin: string;
  try {
    origin = assertStaffOrigin(record.origin);
  } catch {
    throw new Error("dpapi_failed");
  }
  return {
    version: 1,
    tokenSha256Hex: record.tokenSha256Hex,
    origin,
    pairedAt: record.pairedAt,
  };
}

async function writeCipher(file: string, bytes: Buffer, files: BlobFiles): Promise<void> {
  const partial = `${file}.partial`;
  assertOwnedBlob(file);
  assertOwnedBlob(partial, true);
  try {
    await files.write(partial, bytes);
    await files.rename(partial, file);
  } catch (error) {
    await files.remove(partial).catch(() => undefined);
    throw error;
  }
}

function decodeHelperStdout(stdout: Buffer): Buffer {
  const text = stdout.toString("utf8").trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 !== 0 || text.length > 12_000) {
    throw new Error("dpapi_failed");
  }
  return Buffer.from(text, "base64");
}

export function createWindowsDpapiTokenStore(options: {
  platform?: string;
  systemRoot?: string;
  localAppData?: string;
  helperPath?: string;
  runner?: HelperRunner;
  files?: BlobFiles;
} = {}): TokenStore {
  const platform = options.platform ?? process.platform;
  const systemRoot = options.systemRoot ?? process.env.SystemRoot ?? "";
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA ?? "";
  const helperPath = options.helperPath ?? defaultHelperPath();
  const runner = options.runner ?? runOwnedHelper;
  const files = options.files ?? nodeBlobFiles();

  async function transform(op: "protect" | "unprotect", payload: Buffer): Promise<Buffer> {
    const plan = planOwnedHelperSpawn({ systemRoot, helperPath });
    const stdin = dpapiStdin(op, payload);
    const result = await runner({ plan, stdin });
    if (result.code !== 0) throw new Error("dpapi_failed");
    const decoded = decodeHelperStdout(result.stdout);
    if (decoded.length < 1 || decoded.length > 4096) throw new Error("dpapi_failed");
    return decoded;
  }

  return {
    async read() {
      if (platform !== "win32") throw new Error("unsupported_platform");
      const file = pairingBlobPath(localAppData);
      const cipher = await files.read(file);
      if (cipher === null) return null;
      if (cipher.length < 1 || cipher.length > 4096) throw new Error("dpapi_failed");
      return parseStored(await transform("unprotect", cipher));
    },
    async write(record) {
      if (platform !== "win32") throw new Error("unsupported_platform");
      const plain = Buffer.from(JSON.stringify(record), "utf8");
      const cipher = await transform("protect", plain);
      await writeCipher(pairingBlobPath(localAppData), cipher, files);
    },
    async clear() {
      if (platform !== "win32") throw new Error("unsupported_platform");
      await files.remove(pairingBlobPath(localAppData));
    },
  };
}

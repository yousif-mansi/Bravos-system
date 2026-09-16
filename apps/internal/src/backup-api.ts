import {
  BACKUP_SECTION_NAMES,
  type BackupCreateRequest,
  type BackupReadinessDto,
  type BackupSectionCounts,
} from "@bravos/contracts";
import { ApiError } from "./api.ts";

export type { BackupReadinessDto } from "@bravos/contracts";

export type BackupDownload = {
  archive: Blob;
  fileName: string;
  manifest: {
    backupId: string;
    formatVersion: string;
    createdAt: string;
    schemaVersion: string;
    totalRecordCount: number;
    sectionCounts: BackupSectionCounts;
    knownUnsynchronizedTillCount: number;
    includesUnsentBrowserRecords: false;
    imageBinariesIncluded: false;
    sha256: string;
  };
};

export async function getBackupReadiness(signal?: AbortSignal): Promise<BackupReadinessDto> {
  const response = await fetch("/api/internal/backups/readiness", {
    credentials: "include",
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw await responseError(response, "تعذر فحص أجهزة نقاط البيع المعروفة.");
  }
  return parseBackupReadiness(await response.json() as unknown);
}

export async function downloadBusinessBackup(password: string, signal?: AbortSignal): Promise<BackupDownload> {
  const input: BackupCreateRequest = { password };
  const response = await fetch("/api/internal/backups", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw await responseError(response, "تعذر إنشاء النسخة الاحتياطية.");
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/vnd.bravos.backup") throw invalidBackupResponse();
  const manifest = {
    backupId: requiredHeader(response, "x-bravos-backup-id"),
    formatVersion: requiredHeader(response, "x-bravos-backup-format-version"),
    createdAt: requiredHeader(response, "x-bravos-backup-created-at"),
    schemaVersion: requiredHeader(response, "x-bravos-backup-schema-version"),
    totalRecordCount: nonnegativeIntegerHeader(response, "x-bravos-backup-total-record-count"),
    sectionCounts: decodeSectionCounts(requiredHeader(response, "x-bravos-backup-section-counts")),
    knownUnsynchronizedTillCount: nonnegativeIntegerHeader(
      response,
      "x-bravos-backup-known-unsynchronized-till-count",
    ),
    includesUnsentBrowserRecords: false as const,
    imageBinariesIncluded: false as const,
    sha256: requiredHeader(response, "x-bravos-backup-sha256").toLowerCase(),
  };
  if (
    requiredHeader(response, "x-bravos-backup-includes-unsent-browser-records") !== "false"
    || requiredHeader(response, "x-bravos-backup-includes-image-binaries") !== "false"
    || manifest.formatVersion !== "1"
    || !UUID_PATTERN.test(manifest.backupId)
    || !/^[a-f0-9]{64}$/.test(manifest.sha256)
    || !isIsoInstant(manifest.createdAt)
    || !/^\d{3}_.+\.sql$/.test(manifest.schemaVersion)
    || !sectionCountsMatchTotal(manifest.sectionCounts, manifest.totalRecordCount)
  ) {
    throw invalidBackupResponse();
  }
  const archive = await response.blob();
  if (archive.size === 0) throw invalidBackupResponse();
  return {
    archive,
    fileName: safeAttachmentName(response.headers.get("content-disposition")),
    manifest,
  };
}

function sectionCountsMatchTotal(sectionCounts: BackupSectionCounts, totalRecordCount: number): boolean {
  const sectionTotal = BACKUP_SECTION_NAMES.reduce((sum, name) => sum + sectionCounts[name], 0);
  return Number.isSafeInteger(sectionTotal) && sectionTotal === totalRecordCount;
}

async function responseError(response: Response, fallback: string): Promise<ApiError> {
  try {
    const body = await response.json() as { error?: { code?: string; messageAr?: string } };
    return new ApiError(
      response.status,
      body.error?.code ?? "CONFLICT",
      body.error?.messageAr ?? fallback,
    );
  } catch {
    return new ApiError(response.status, "CONFLICT", fallback);
  }
}

function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (!value) throw invalidBackupResponse();
  return value;
}

function nonnegativeIntegerHeader(response: Response, name: string): number {
  const value = requiredHeader(response, name);
  if (!/^\d+$/.test(value)) throw invalidBackupResponse();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw invalidBackupResponse();
  return parsed;
}

function decodeSectionCounts(encoded: string): BackupSectionCounts {
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("invalid counts");
    const entries = Object.entries(parsed);
    if (entries.some(([key, value]) => !key || typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
      throw new Error("invalid counts");
    }
    const counts = Object.fromEntries(entries) as Record<string, number>;
    if (
      entries.length !== BACKUP_SECTION_NAMES.length
      || BACKUP_SECTION_NAMES.some((name) => counts[name] === undefined)
    ) {
      throw new Error("invalid counts");
    }
    return counts as BackupSectionCounts;
  } catch {
    throw invalidBackupResponse();
  }
}

function parseBackupReadiness(value: unknown): BackupReadinessDto {
  if (!value || Array.isArray(value) || typeof value !== "object") throw invalidBackupReadiness();
  const body = value as Partial<BackupReadinessDto>;
  if (
    body.includesUnsentBrowserRecords !== false
    || body.imageBinariesIncluded !== false
    || body.imageReferencesPreserved !== true
    || typeof body.knownUnsynchronizedTillCount !== "number"
    || !Number.isSafeInteger(body.knownUnsynchronizedTillCount)
    || body.knownUnsynchronizedTillCount < 0
    || !Array.isArray(body.knownUnsynchronizedTills)
    || body.knownUnsynchronizedTillCount !== body.knownUnsynchronizedTills.length
  ) {
    throw invalidBackupReadiness();
  }
  const deviceIds = new Set<string>();
  for (const till of body.knownUnsynchronizedTills) {
    if (
      !till
      || typeof till.deviceId !== "string"
      || !UUID_PATTERN.test(till.deviceId)
      || deviceIds.has(till.deviceId)
      || typeof till.staffId !== "string"
      || typeof till.latestSnapshotId !== "string"
      || !UUID_PATTERN.test(till.latestSnapshotId)
      || typeof till.latestSnapshotAt !== "string"
      || !isIsoInstant(till.latestSnapshotAt)
      || !(till.stockVersion === null || (typeof till.stockVersion === "string" && /^\d+$/.test(till.stockVersion)))
      || !Array.isArray(till.pendingOperationIds)
      || till.pendingOperationIds.some((operationId) => typeof operationId !== "string" || !UUID_PATTERN.test(operationId))
      || !Number.isSafeInteger(till.pendingOperationCount)
      || till.pendingOperationCount < 0
      || till.pendingOperationCount !== till.pendingOperationIds.length
    ) {
      throw invalidBackupReadiness();
    }
    deviceIds.add(till.deviceId);
  }
  return body as BackupReadinessDto;
}

function safeAttachmentName(contentDisposition: string | null): string {
  const match = contentDisposition?.match(/(?:^|;)\s*filename="([^"]+)"(?:;|$)/i);
  const candidate = match?.[1];
  if (candidate && isSafeBackupFileName(candidate)) return candidate;
  throw invalidBackupResponse();
}

function isSafeBackupFileName(value: string): boolean {
  return /^bravos-business-backup-[a-zA-Z0-9_-]+\.bravos-backup$/.test(value);
}

function invalidBackupResponse(): ApiError {
  return new ApiError(502, "INVALID_BACKUP_RESPONSE", "وصل ملف نسخة احتياطية غير مكتمل. لم يتم تنزيله؛ أعد المحاولة.");
}

function invalidBackupReadiness(): ApiError {
  return new ApiError(502, "INVALID_BACKUP_READINESS", "تعذر التحقق من نطاق النسخة الاحتياطية. أعد تحميل الصفحة ثم حاول مجدداً.");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isIsoInstant(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

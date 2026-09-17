import type {
  RestoreAcknowledgementRequest,
  RestoreCheckpointAcknowledgementRequest,
  RestoreConfirmRequest,
  RestoreDeferredSaleDto,
  RestorePreviewDto,
  RestorePreviewRequest,
  RestoreStateDto,
} from "@bravos/contracts";
import { ApiError, request, type SyncedSaleDto } from "./api.ts";


export type VerifiedPreRestoreBackup = {
  archive: Blob;
  archiveSha256: string;
  fileName: string;
};

export function getRestoreState(signal?: AbortSignal) {
  return request<RestoreStateDto>("/api/internal/restore/state", { cache: "no-store", ...(signal ? { signal } : {}) });
}

export function getRestorePause(signal?: AbortSignal) {
  return request<RestoreStateDto>("/api/internal/restore/pause", { cache: "no-store", ...(signal ? { signal } : {}) });
}

export function listRestorePreviews(signal?: AbortSignal) {
  return request<RestorePreviewDto[]>("/api/internal/restore/previews", { cache: "no-store", ...(signal ? { signal } : {}) });
}

export function getRestorePreview(previewId: string, signal?: AbortSignal) {
  return request<RestorePreviewDto>(`/api/internal/restore/previews/${previewId}`, { cache: "no-store", ...(signal ? { signal } : {}) });
}

export function createRestorePreview(input: RestorePreviewRequest, signal?: AbortSignal) {
  return request<RestorePreviewDto>("/api/internal/restore/previews", {
    method: "POST",
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });
}

export function acknowledgeRestoreDevice(
  previewId: string,
  input: RestoreAcknowledgementRequest,
  signal?: AbortSignal,
) {
  return request<RestorePreviewDto>(`/api/internal/restore/previews/${previewId}/acknowledgements`, {
    method: "POST",
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });
}

export function cancelRestorePreview(previewId: string, signal?: AbortSignal) {
  return request<RestorePreviewDto>(`/api/internal/restore/previews/${previewId}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
    ...(signal ? { signal } : {}),
  });
}

export function acknowledgePreRestoreBackup(
  previewId: string,
  input: RestoreCheckpointAcknowledgementRequest,
  signal?: AbortSignal,
) {
  return request<RestorePreviewDto>(`/api/internal/restore/previews/${previewId}/pre-restore-backup/acknowledgement`, {
    method: "POST",
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });
}

export function activateRestorePreview(previewId: string, input: RestoreConfirmRequest, signal?: AbortSignal) {
  return request<RestorePreviewDto>(`/api/internal/restore/previews/${previewId}/activate`, {
    method: "POST",
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });
}

export function listRestoreDeferredSales(signal?: AbortSignal) {
  return request<RestoreDeferredSaleDto[]>("/api/internal/sales/restore-deferred", {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
}

export function recoverRestoreDeferredSale(sale: RestoreDeferredSaleDto, signal?: AbortSignal) {
  return request<SyncedSaleDto>("/api/internal/sales/recover", {
    method: "POST",
    body: JSON.stringify(sale.recoveryPayload),
    ...(signal ? { signal } : {}),
  });
}

export async function downloadPreRestoreBackup(
  previewId: string,
  expectedSha256: string,
  signal?: AbortSignal,
): Promise<VerifiedPreRestoreBackup> {
  const response = await fetch(`/api/internal/restore/previews/${previewId}/pre-restore-backup`, {
    credentials: "include",
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw await responseError(response, "تعذر تنزيل نسخة ما قبل الاستعادة.");
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const headerSha256 = response.headers.get("x-bravos-backup-sha256")?.trim().toLowerCase() ?? "";
  if (
    contentType !== "application/vnd.bravos.backup"
    || !/^[a-f0-9]{64}$/.test(headerSha256)
    || headerSha256 !== expectedSha256.toLowerCase()
  ) {
    throw invalidCheckpoint();
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) throw invalidCheckpoint();
  const actualSha256 = await sha256(bytes);
  if (actualSha256 !== headerSha256) throw invalidCheckpoint();
  return {
    archive: new Blob([bytes], { type: "application/vnd.bravos.backup" }),
    archiveSha256: actualSha256,
    fileName: safeAttachmentName(response.headers.get("content-disposition")),
  };
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function safeAttachmentName(contentDisposition: string | null): string {
  const match = contentDisposition?.match(/(?:^|;)\s*filename="([^"]+)"(?:;|$)/i);
  const candidate = match?.[1];
  if (candidate && /^[a-zA-Z0-9._-]+\.bravos-backup$/.test(candidate) && !candidate.includes("..")) {
    return candidate;
  }
  return "bravos-pre-restore-backup.bravos-backup";
}

async function responseError(response: Response, fallback: string): Promise<ApiError> {
  try {
    const body = await response.json() as { error?: { code?: string; messageAr?: string } };
    return new ApiError(response.status, body.error?.code ?? "CONFLICT", body.error?.messageAr ?? fallback);
  } catch {
    return new ApiError(response.status, "CONFLICT", fallback);
  }
}

function invalidCheckpoint() {
  return new ApiError(
    502,
    "INVALID_RESTORE_CHECKPOINT",
    "فشل التحقق من نسخة ما قبل الاستعادة. لم يبدأ التنزيل ولم يُسجل الإقرار.",
  );
}

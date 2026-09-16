import { ApiError, managementReportSearchParams, type ManagementReportQuery } from "./api.ts";

export type ReportExportFormat = "pdf" | "xlsx";

export type ReportExportDownload = {
  blob: Blob;
  fileName: string;
};

export async function getManagementReportExport(
  format: ReportExportFormat,
  query: ManagementReportQuery,
  signal?: AbortSignal,
): Promise<ReportExportDownload> {
  const params = managementReportSearchParams(query, false);
  params.set("format", format);
  const response = await fetch(`/api/internal/reports/management/export?${params.toString()}`, {
    credentials: "include",
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await exportError(response);
  const expectedContentType = format === "pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== expectedContentType) {
    throw new Error("unexpected-export-content-type");
  }
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("empty-export");
  return {
    blob,
    fileName: attachmentName(response.headers.get("content-disposition")) ?? `bravos-management-report.${format}`,
  };
}

type ExportErrorBody = { error?: { code?: string; messageAr?: string } };

async function exportError(response: Response) {
  let body = null as ExportErrorBody | null;
  try {
    body = await response.json() as ExportErrorBody;
  } catch {
    // Some gateway failures do not carry the application JSON error shape.
  }
  return new ApiError(
    response.status,
    body?.error?.code ?? "CONFLICT",
    body?.error?.messageAr ?? "تعذر تجهيز ملف التقرير.",
  );
}

function attachmentName(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (utf8) {
    try {
      return safeFileName(decodeURIComponent(utf8));
    } catch {
      return null;
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header)?.[1];
  return plain ? safeFileName(plain) : null;
}

function safeFileName(value: string): string | null {
  const name = value.trim().replace(/[\\/]/g, "-");
  return name && name !== "." && name !== ".." ? name : null;
}

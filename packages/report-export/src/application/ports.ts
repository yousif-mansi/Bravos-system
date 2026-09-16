import type { ManagementReportDto } from "@bravos/contracts";
import type { VerifiedAuth } from "@bravos/identity";

export type { VerifiedAuth };

export type ReportExportFormat = "pdf" | "xlsx";

export type ManagementReportSnapshotReader = {
  getManagementReportExportSnapshot(
    auth: VerifiedAuth | null,
    query: unknown,
  ): Promise<ManagementReportDto>;
};

export type RenderedReport = {
  bytes: Uint8Array;
  contentType: "application/pdf" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  extension: ReportExportFormat;
};

export type ReportRenderer = {
  preflight(format: ReportExportFormat, report: ManagementReportDto): void;
  contentBytes(report: ManagementReportDto): number;
  render(format: ReportExportFormat, report: ManagementReportDto): Promise<RenderedReport>;
};

export type ReportExportFile = RenderedReport & {
  fileName: string;
};

export type ReportExportServices = {
  management(auth: VerifiedAuth | null, query: unknown): Promise<ReportExportFile>;
};

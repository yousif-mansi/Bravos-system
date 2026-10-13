import { ReportExportValidationError } from "../domain/errors.ts";
import type {
  ManagementReportSnapshotReader,
  ReportExportFormat,
  ReportExportServices,
  ReportRenderer,
} from "./ports.ts";

const EXPORT_QUERY_KEYS = new Set([
  "format",
  "period",
  "date",
  "month",
  "branchId",
  "channel",
  "employeeId",
]);
const MAX_DETAIL_ROWS: Record<ReportExportFormat, number> = {
  pdf: 5_000,
  xlsx: 25_000,
};
const MAX_RENDER_CONTENT_BYTES: Record<ReportExportFormat, number> = {
  pdf: 8 * 1_024 * 1_024,
  xlsx: 32 * 1_024 * 1_024,
};

export function createReportExportServices(input: {
  reports: ManagementReportSnapshotReader;
  renderer: ReportRenderer;
}): ReportExportServices {
  return {
    async management(auth, rawQuery) {
      const { format, reportQuery } = parseExportQuery(rawQuery);
      const report = await input.reports.getManagementReportExportSnapshot(auth, reportQuery);
      input.renderer.preflight(format, report);
      if (
        detailRows(report) > MAX_DETAIL_ROWS[format]
        || input.renderer.contentBytes(report) > MAX_RENDER_CONTENT_BYTES[format]
      ) {
        throw new ReportExportValidationError("التقرير كبير جداً للتصدير. اختر فترة أو مرشحات أضيق.");
      }
      const rendered = await input.renderer.render(format, report);
      return {
        ...rendered,
        fileName: `bravos-management-report-${report.period.fromCairoDate}-${report.period.toCairoDateInclusive}.${rendered.extension}`,
      };
    },
  };
}

function parseExportQuery(value: unknown): { format: ReportExportFormat; reportQuery: Record<string, unknown> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReportExportValidationError("مرشحات تصدير التقرير غير صالحة.");
  }
  const query = value as Record<string, unknown>;
  if (Object.keys(query).some((key) => !EXPORT_QUERY_KEYS.has(key))) {
    throw new ReportExportValidationError("مرشحات تصدير التقرير غير صالحة.");
  }
  if (query.format !== "pdf" && query.format !== "xlsx") {
    throw new ReportExportValidationError("صيغة تصدير التقرير غير صالحة.");
  }
  const { format, ...reportQuery } = query;
  return { format, reportQuery };
}

function detailRows(
  report: Awaited<ReturnType<ManagementReportSnapshotReader["getManagementReportExportSnapshot"]>>,
): number {
  return report.byChannel.length
    + report.byBranch.length
    + report.byEmployee.length
    + report.completedSales.length
    + report.completedSales.reduce((sum, sale) => sum + sale.lines.length, 0)
    + report.completedSales.reduce((sum, sale) => sum + sale.corrections.length, 0)
    + report.refunds.length
    + report.refunds.reduce((sum, refund) => sum + refund.corrections.length + refund.refundCashEvents.length, 0)
    + report.purchases.receipts.length
    + report.purchases.receipts.reduce((sum, receipt) => sum + receipt.lines.length + receipt.corrections.length, 0)
    + report.openingStock.receipts.length
    + report.openingStock.receipts.reduce((sum, receipt) => sum + receipt.lines.length + receipt.corrections.length, 0)
    + report.expenses.items.length
    + report.expenses.items.reduce((sum, expense) => sum + expense.corrections.length, 0)
    + report.bestSellers.length
    + report.lowStock.length;
}

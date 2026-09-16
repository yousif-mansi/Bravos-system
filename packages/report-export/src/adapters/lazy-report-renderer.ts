import type { ReportRenderer } from "../application/ports.ts";
import { ReportExportValidationError } from "../domain/errors.ts";
import {
  hasOversizedSpreadsheetCell,
  managementReportContentBytes,
} from "../document/report-sheets.ts";

const EXCEL_CELL_CHARACTER_LIMIT = 32_767;

export function createLazyReportRenderer(options?: { arabicFontPath?: string }): ReportRenderer {
  return {
    preflight(format, report) {
      if (format === "xlsx" && hasOversizedSpreadsheetCell(report, EXCEL_CELL_CHARACTER_LIMIT)) {
        throw new ReportExportValidationError(
          "يتضمن التقرير نصاً أطول مما يدعمه Excel. استخدم PDF أو ضيّق الفترة أو المرشحات.",
        );
      }
    },
    contentBytes: managementReportContentBytes,
    async render(format, report) {
      if (format === "xlsx") {
        const { renderManagementReportXlsx } = await import("./xlsx-report.ts");
        return renderManagementReportXlsx(report);
      }
      const { renderManagementReportPdf } = await import("./pdf-report.ts");
      return renderManagementReportPdf(report, options?.arabicFontPath);
    },
  };
}

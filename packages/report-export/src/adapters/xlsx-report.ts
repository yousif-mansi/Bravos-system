import type { ManagementReportDto } from "@bravos/contracts";
import type { RenderedReport } from "../application/ports.ts";
import {
  displayNullCell,
  isPoundLabel,
  managementReportSheets,
  safeSpreadsheetText,
  type ReportCell,
} from "../document/report-sheets.ts";

export { safeSpreadsheetText } from "../document/report-sheets.ts";

export async function renderManagementReportXlsx(report: ManagementReportDto): Promise<RenderedReport> {
  const ExcelJSImport = await import("@ayocore/exceljs");
  const ExcelJS = ExcelJSImport.default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BRAVOS";
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  workbook.calcProperties.fullCalcOnLoad = false;

  for (const definition of managementReportSheets(report)) {
    const worksheet = workbook.addWorksheet(definition.nameAr.slice(0, 31), {
      views: [{ rightToLeft: true }],
      pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1 },
    });
    worksheet.addRow(definition.columnsAr.map(safeSpreadsheetText));
    for (const row of definition.rows) {
      const added = worksheet.addRow(row.map((value, index) => spreadsheetCell(value, cellLabel(definition.columnsAr, row, index))));
      row.forEach((value, index) => {
        if (typeof value === "number" && isPoundLabel(cellLabel(definition.columnsAr, row, index))) {
          added.getCell(index + 1).numFmt = "#,##0.00";
        }
      });
    }
    worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF263238" } };
    worksheet.getRow(1).alignment = { horizontal: "right", readingOrder: "rtl" };
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: definition.rows.length + 1, column: definition.columnsAr.length },
    };
    worksheet.columns.forEach((column) => {
      column.width = 22;
      column.alignment = { horizontal: "right", vertical: "middle", readingOrder: "rtl", wrapText: true };
    });
    worksheet.views = [{ state: "frozen", ySplit: 1, rightToLeft: true }];
  }

  const bytes = await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true });
  return {
    bytes: new Uint8Array(bytes),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
  };
}

function cellLabel(columns: string[], row: ReportCell[], index: number): string | undefined {
  const column = columns[index];
  return index === 1 && columns[0] === "البيان" && typeof row[0] === "string" ? row[0] : column;
}

function spreadsheetCell(value: ReportCell, label: string | undefined): string | number {
  if (value === null) return displayNullCell(label);
  return typeof value === "string" ? safeSpreadsheetText(value) : value;
}

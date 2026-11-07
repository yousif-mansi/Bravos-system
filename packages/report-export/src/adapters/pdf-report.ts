import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ManagementReportDto } from "@bravos/contracts";
import type { RenderedReport } from "../application/ports.ts";
import {
  displayNullCell,
  isPoundLabel,
  managementReportPresentation,
  managementReportSheets,
  type ReportCell,
} from "../document/report-sheets.ts";

const SOURCE_FONT_PATH = fileURLToPath(new URL("../../assets/Cairo-Regular.ttf", import.meta.url));
const BUNDLED_FONT_PATH = fileURLToPath(new URL("./assets/Cairo-Regular.ttf", import.meta.url));
const COMPACT_SHEETS = new Set(["الملخص", "المخزون", "الطلبات التشغيلية"]);

export async function renderManagementReportPdf(
  report: ManagementReportDto,
  arabicFontPath = defaultArabicFontPath(),
): Promise<RenderedReport> {
  const presentation = managementReportPresentation(report);
  const [React, renderer] = await Promise.all([import("react"), import("@react-pdf/renderer")]);
  renderer.Font.register({ family: "BravosArabic", src: arabicFontPath });
  renderer.Font.registerHyphenationCallback((word) => [word]);
  const styles = renderer.StyleSheet.create({
    page: { direction: "rtl", fontFamily: "BravosArabic", fontSize: 8, padding: 28, color: "#1f2933" },
    title: { direction: "rtl", textAlign: "right", fontSize: 18, marginBottom: 8 },
    subtitle: { direction: "rtl", textAlign: "right", fontSize: 9, color: "#52606d", marginBottom: 12 },
    section: { direction: "rtl", marginBottom: 12 },
    sectionTitle: { direction: "rtl", textAlign: "right", fontSize: 12, backgroundColor: "#e8ecef", padding: 5, marginBottom: 4 },
    row: { direction: "rtl", textAlign: "right", fontSize: 7, borderWidth: 0.5, borderColor: "#d9e2ec", padding: 5, marginBottom: 3 },
    compactRow: { direction: "rtl", flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#d9e2ec", minHeight: 15 },
    compactLabel: { direction: "rtl", textAlign: "right", width: "34%", padding: 2, fontSize: 7 },
    compactValue: { direction: "rtl", textAlign: "right", width: "16%", padding: 2, fontSize: 7, backgroundColor: "#f5f7f8" },
    empty: { direction: "rtl", textAlign: "right", color: "#7b8794", padding: 4 },
    footer: { direction: "rtl", textAlign: "center", fontSize: 7, color: "#7b8794", position: "absolute", bottom: 12, left: 28, right: 28 },
  });
  const element = React.createElement(
    renderer.Document,
    { title: "تقرير الإدارة - برافوس", author: "BRAVOS", language: "ar" },
    React.createElement(
      renderer.Page,
      { size: "A4", orientation: "landscape", style: styles.page, wrap: true },
      React.createElement(renderer.Text, { style: styles.title }, "تقرير الإدارة - برافوس"),
      React.createElement(
        renderer.Text,
        { style: styles.subtitle },
        `الفترة: ${presentation.periodAr} (${report.period.fromCairoDate} إلى ${report.period.toCairoDateInclusive}) | القناة: ${presentation.channelAr} | الفرع: ${pdfCell(presentation.branchAr)} | الموظف: ${pdfCell(presentation.employeeAr)}`,
      ),
      ...managementReportSheets(report).map((sheet, sheetIndex) =>
        React.createElement(
          renderer.View,
          { key: `${sheetIndex}-${sheet.nameAr}`, style: styles.section },
          React.createElement(renderer.Text, { style: styles.sectionTitle }, sheet.nameAr),
          ...(sheet.rows.length === 0
            ? [React.createElement(renderer.Text, { key: "empty", style: styles.empty }, "لا توجد بيانات")]
            : COMPACT_SHEETS.has(sheet.nameAr)
              ? pairRows(sheet.rows).map((pair, rowIndex) =>
                  React.createElement(
                    renderer.View,
                    { key: rowIndex, style: styles.compactRow, wrap: false },
                    ...pair.flatMap((row, pairIndex) => [
                      React.createElement(renderer.Text, { key: `${pairIndex}-label`, style: styles.compactLabel }, pdfCell(row[0] ?? null)),
                      React.createElement(renderer.Text, { key: `${pairIndex}-value`, style: styles.compactValue }, pdfCell(row[1] ?? null, typeof row[0] === "string" ? row[0] : undefined)),
                    ]),
                  ),
                )
            : sheet.rows.map((row, rowIndex) =>
                React.createElement(
                  renderer.View,
                  { key: rowIndex, style: styles.row },
                  React.createElement(
                    renderer.Text,
                    { style: { direction: "rtl", textAlign: "right" } },
                    row.map((value, columnIndex) => `${sheet.columnsAr[columnIndex] ?? "القيمة"}: ${pdfCell(value, sheet.columnsAr[columnIndex])}`).join("\n"),
                  ),
                ),
              )),
        ),
      ),
      React.createElement(renderer.Text, {
        fixed: true,
        style: styles.footer,
        render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
          `صفحة ${pageNumber} من ${totalPages}`,
      }),
    ),
  );
  const stream = await renderer.renderToStream(element);
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk));
  }
  return {
    bytes: new Uint8Array(Buffer.concat(chunks)),
    contentType: "application/pdf",
    extension: "pdf",
  };
}

function defaultArabicFontPath(): string {
  const fontPath = [SOURCE_FONT_PATH, BUNDLED_FONT_PATH].find((candidate) => existsSync(candidate));
  if (!fontPath) throw new Error("Arabic report font asset is missing.");
  return fontPath;
}

function pdfCell(value: ReportCell, label?: string): string {
  if (value === null) return displayNullCell(label);
  if (typeof value === "number") return isPoundLabel(label) ? value.toFixed(2) : `${value}`;
  // Keep UUID segments in their original order within Arabic right-to-left text.
  return value.replace(/[\u0000-\u001F]/g, " ").replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    (id) => `\u200e${id}\u200e`,
  );
}

function pairRows(rows: ReportCell[][]): ReportCell[][][] {
  const pairs: ReportCell[][][] = [];
  for (let index = 0; index < rows.length; index += 2) {
    pairs.push(rows.slice(index, index + 2));
  }
  return pairs;
}

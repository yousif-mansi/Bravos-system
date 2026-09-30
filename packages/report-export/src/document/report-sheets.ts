import type { ManagementReportDto } from "@bravos/contracts";

export type ReportCell = string | number | null;
export type ReportSheet = { nameAr: string; columnsAr: string[]; rows: ReportCell[][] };
export type ReportPresentation = {
  periodAr: string;
  channelAr: string;
  branchAr: string;
  employeeAr: string;
};

export function managementReportContentBytes(report: ManagementReportDto): number {
  const encoder = new TextEncoder();
  let total = 0;
  for (const sheet of managementReportSheets(report)) {
    total += encoder.encode(sheet.nameAr).byteLength;
    for (const column of sheet.columnsAr) total += encoder.encode(column).byteLength;
    for (const row of sheet.rows) {
      for (let index = 0; index < row.length; index += 1) {
        const column = sheet.columnsAr[index] ?? "القيمة";
        const value = row[index];
        total += encoder.encode(`${column}: ${value === null ? displayNullCell(column) : value}`).byteLength;
      }
    }
  }
  return total;
}

export function hasOversizedSpreadsheetCell(report: ManagementReportDto, maximumCharacters: number): boolean {
  return managementReportSheets(report).some((sheet) =>
    sheet.columnsAr.some((column) => safeSpreadsheetText(column).length > maximumCharacters)
    || sheet.rows.some((row) => row.some((cell) =>
      typeof cell === "string" && safeSpreadsheetText(cell).length > maximumCharacters
    )),
  );
}

export function safeSpreadsheetText(value: string): string {
  const normalized = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  return /^[\t\r\n ]*[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
}

export function managementReportPresentation(report: ManagementReportDto): ReportPresentation {
  const branch = report.filters.branchId
    ? report.byBranch.find((row) => row.branch.id === report.filters.branchId)?.branch
    : null;
  const employee = report.filters.employeeId
    ? report.byEmployee.find((row) => row.staffId === report.filters.employeeId)
      ?? report.completedSales.flatMap((row) => row.employee ? [row.employee] : [])
        .find((row) => row.staffId === report.filters.employeeId)
      ?? report.expenses.items
        .filter((row) => row.createdByStaffId === report.filters.employeeId)
        .map((row) => ({ staffId: row.createdByStaffId, displayName: row.createdByDisplayName }))[0]
    : null;
  return {
    periodAr: report.period.labelAr,
    channelAr: channelAr(report.filters.channel),
    branchAr: report.filters.branchId
      ? auditLabel(branch?.nameAr, report.filters.branchId)
      : "كل الفروع",
    employeeAr: report.filters.employeeId
      ? auditLabel(employee?.displayName, report.filters.employeeId)
      : "كل الموظفين",
  };
}

const PIASTER_LABEL = "(قرش)";
const POUND_LABEL = "(ج.م)";
const CAIRO_TIME_COLUMNS = new Set(["وقت البيع/التأكيد", "وقت الترحيل", "الوقت"]);
const CAIRO_DATE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function isPoundLabel(label: string | null | undefined): boolean {
  return typeof label === "string" && label.includes(POUND_LABEL);
}

export function displayNullCell(label: string | null | undefined): string {
  return typeof label === "string" && label.includes("ربح") ? "غير مكتمل — توجد تكلفة غير معروفة" : "غير متاح";
}

export function managementReportSheets(report: ManagementReportDto): ReportSheet[] {
  return rawManagementReportSheets(report).map(presentSheet);
}

function presentSheet(sheet: ReportSheet): ReportSheet {
  const columnsAr = sheet.columnsAr.map((column) => CAIRO_TIME_COLUMNS.has(column)
    ? `${column} (القاهرة)` : column.replace(PIASTER_LABEL, POUND_LABEL));
  const rows = sheet.rows.map((row) => row.map((cell, index) => {
    const column = sheet.columnsAr[index] ?? "";
    if (CAIRO_TIME_COLUMNS.has(column) && typeof cell === "string") return cairoDateTime(cell);
    if (column.includes(PIASTER_LABEL)) return pounds(cell);
    if (index === 0 && typeof cell === "string" && cell.includes(PIASTER_LABEL)) return cell.replace(PIASTER_LABEL, POUND_LABEL);
    if (index === 1 && typeof row[0] === "string" && row[0].includes(PIASTER_LABEL)) return pounds(cell);
    return cell;
  }));
  return { ...sheet, columnsAr, rows };
}

function pounds(value: ReportCell): ReportCell {
  return typeof value === "number" ? value / 100 : value;
}

function cairoDateTime(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return value;
  const parts = CAIRO_DATE_TIME.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function rawManagementReportSheets(report: ManagementReportDto): ReportSheet[] {
  const presentation = managementReportPresentation(report);
  const summary: ReportSheet = {
    nameAr: "الملخص",
    columnsAr: ["البيان", "القيمة"],
    rows: [
      ["نوع الفترة", periodKindAr(report.period.kind)],
      ["وصف الفترة", report.period.labelAr],
      ["من تاريخ القاهرة", report.period.fromCairoDate],
      ["إلى تاريخ القاهرة", report.period.toCairoDateInclusive],
      ["فرع التصفية", presentation.branchAr],
      ["قناة التصفية", presentation.channelAr],
      ["موظف التصفية", presentation.employeeAr],
      ["عدد تفاصيل المبيعات", report.pageInfo.totalCompletedSales],
      ["عدد تفاصيل المرتجعات", report.pageInfo.totalRefunds],
      ["عدد تفاصيل المشتريات", report.pageInfo.totalPurchases],
      ["عدد تفاصيل المصروفات", report.pageInfo.totalExpenses],
      ["عدد مبيعات الفروع والطلبات المؤكدة", report.summary.completedCount],
      ["إجمالي المبيعات النهائية (قرش)", report.summary.grossFinalSalesPiasters],
      ["إجمالي مبيعات البضاعة (قرش)", report.summary.grossMerchandiseSalesPiasters],
      ["رسوم التوصيل (قرش)", report.summary.deliveryChargesPiasters],
      ["مرتجعات البضاعة (قرش)", report.summary.merchandiseRefundPiasters],
      ["مرتجعات رسوم الطلب (قرش)", report.summary.checkoutChargeRefundPiasters],
      ["صافي المبيعات النهائية (قرش)", report.summary.netFinalSalesPiasters],
      ["صافي مبيعات البضاعة (قرش)", report.summary.netMerchandiseSalesPiasters],
      ["تكلفة البضاعة الصافية المعروفة (قرش)", report.summary.knownNetMerchandiseCostPiasters],
      ["مجمل ربح البضاعة (قرش)", report.summary.merchandiseGrossProfitPiasters],
      ["المصروفات الفعلية (قرش)", report.summary.effectiveExpensesPiasters],
      ["الربح التشغيلي (قرش)", report.summary.operatingProfitPiasters],
      ["تكلفة المشتريات (قرش)", report.summary.purchaseCostPiasters],
      ["تكاليف غير مكتملة", yesNo(report.summary.costsIncomplete)],
      ["كمية بتكلفة غير محسومة", report.summary.unresolvedCostQuantity],
    ],
  };

  return [
    summary,
    {
      nameAr: "حسب القناة",
      columnsAr: ["القناة", "العدد", "الإجمالي النهائي (قرش)", "إجمالي البضاعة (قرش)", "مرتجع البضاعة (قرش)", "صافي البضاعة (قرش)", "التكلفة المعروفة (قرش)", "مجمل الربح (قرش)", "تكلفة غير مكتملة"],
      rows: report.byChannel.map((row) => [channelAr(row.channel), row.completedCount, row.grossFinalSalesPiasters, row.grossMerchandiseSalesPiasters, row.merchandiseRefundPiasters, row.netMerchandiseSalesPiasters, row.knownNetMerchandiseCostPiasters, row.grossProfitPiasters, yesNo(row.costsIncomplete)]),
    },
    {
      nameAr: "حسب الفرع",
      columnsAr: ["الفرع", "العدد", "الإجمالي النهائي (قرش)", "إجمالي البضاعة (قرش)", "مرتجع البضاعة (قرش)", "صافي البضاعة (قرش)", "التكلفة المعروفة (قرش)", "مجمل الربح (قرش)", "المصروفات (قرش)", "الربح التشغيلي (قرش)", "تكلفة غير مكتملة"],
      rows: report.byBranch.map((row) => [auditLabel(row.branch.nameAr, row.branch.id), row.completedCount, row.grossFinalSalesPiasters, row.grossMerchandiseSalesPiasters, row.merchandiseRefundPiasters, row.netMerchandiseSalesPiasters, row.knownNetMerchandiseCostPiasters, row.grossProfitPiasters, row.effectiveExpensesPiasters, row.operatingProfitPiasters, yesNo(row.costsIncomplete)]),
    },
    {
      nameAr: "حسب الموظف",
      columnsAr: ["الموظف", "المعرف", "العدد", "الإجمالي النهائي (قرش)", "إجمالي البضاعة (قرش)", "خصم الموظف (قرش)", "مرتجع البضاعة (قرش)", "المصروفات (قرش)"],
      rows: report.byEmployee.map((row) => [row.displayName, row.staffId, row.completedCount, row.grossFinalSalesPiasters, row.grossMerchandiseSalesPiasters, row.employeeDiscountPiasters, row.merchandiseRefundPiasters, row.effectiveExpensesPiasters]),
    },
    {
      nameAr: "المبيعات المكتملة",
      columnsAr: ["المرجع", "معرف المصدر", "نوع المصدر", "القناة", "وقت البيع/التأكيد", "الحالة", "مراجعة التصحيح", "الفرع", "الموظف", "معرف الموظف", "الإجمالي الأصلي (قرش)", "خصم العرض (قرش)", "خصم الكوبون (قرش)", "خصم الموظف (قرش)", "منفذ خصم الموظف", "سبب خصم الموظف", "البضاعة الفعلية (قرش)", "التوصيل (قرش)", "الإجمالي الفعلي (قرش)", "التكلفة المعروفة (قرش)", "كمية غير محسومة", "تكلفة غير مكتملة"],
      rows: report.completedSales.map((row) => [row.source.reference, row.source.id, sourceKindAr(row.source.kind, "sale"), channelAr(row.channel), row.occurredAt, effectiveStatusAr(row.effectiveStatus), row.correctionRevision, row.branch ? auditLabel(row.branch.nameAr, row.branch.id) : null, row.employee?.displayName ?? null, row.employee?.staffId ?? null, row.accepted.originalPiasters, row.accepted.automaticOfferDiscountPiasters, row.accepted.couponDiscountPiasters, row.accepted.employeeDiscountPiasters, row.accepted.employeeDiscountedByStaffId, row.accepted.employeeDiscountReason, row.effectiveMerchandisePiasters, row.deliveryChargePiasters, row.effectiveFinalPiasters, row.knownCostPiasters, row.unresolvedCostQuantity, yesNo(row.costsIncomplete)]),
    },
    {
      nameAr: "تفاصيل المبيعات",
      columnsAr: ["مرجع البيع", "معرف السطر", "كود المنتج", "اسم المنتج", "معرف المتغير", "المقاس", "اللون", "الكمية", "المدفوع (قرش)"],
      rows: report.completedSales.flatMap((sale) => sale.lines.map((line) => [sale.source.reference, line.sourceLineId, line.productCode, line.productNameAr, line.variantId, line.variant.size.nameAr, line.variant.color.nameAr, line.quantity, line.paidPiasters])),
    },
    {
      nameAr: "تصحيحات المبيعات",
      columnsAr: ["معرف المصدر", "معرف التصحيح", "النوع", "المراجعة", "السبب", "معرف المنفذ", "اسم المنفذ", "الوقت"],
      rows: report.completedSales.flatMap((sale) => sale.corrections.map((change) => [sale.source.id, change.id, correctionTypeAr(change.type), change.revision, change.reason, change.changedByStaffId, change.changedByDisplayName, change.changedAt])),
    },
    {
      nameAr: "المرتجعات",
      columnsAr: ["معرف المرتجع", "وقت الترحيل", "نوع المصدر", "معرف المصدر", "القناة", "فرع الأصل", "فرع المعالجة", "الحالة", "مراجعة التصحيح", "مرتجع البضاعة (قرش)", "مرتجع رسوم الطلب (قرش)", "إجمالي المرتجع (قرش)", "التكلفة المستعادة (قرش)", "المدفوع فعلياً (قرش)", "حالة رد النقد", "رد النقد المستحق إجمالاً (قرش)", "بيع الاستبدال", "بضاعة الاستبدال (قرش)", "الرصيد المطبق (قرش)", "النقد المحصل (قرش)", "نقد الاستبدال المسترد المستحق (قرش)", "نقد الاستبدال المسترد المدفوع (قرش)"],
      rows: report.refunds.map((row) => [row.returnId, row.postedAt, sourceKindAr(row.source.kind), row.source.id, channelAr(row.channel), branchAuditLabel(report, row.originalBranchId), branchAuditLabel(report, row.handlingBranchId), effectiveStatusAr(row.effectiveStatus), row.correctionRevision, row.authorizedRefund.merchandisePiasters, row.authorizedRefund.checkoutChargePiasters, row.authorizedRefund.totalPiasters, row.sellableRestoredCostPiasters, row.actualRefundPaidPiasters, cashRefundStatusAr(row.cashRefundStatus), row.cashRefundOwedPiasters, row.exchange?.replacementSaleId ?? null, row.exchange?.replacementMerchandisePiasters ?? null, row.exchange?.creditAppliedPiasters ?? null, row.exchange?.cashCollectedPiasters ?? null, row.exchange?.cashRefundOwedPiasters ?? null, row.exchange?.cashRefundPaidPiasters ?? null]),
    },
    {
      nameAr: "حركات نقد المرتجعات",
      columnsAr: ["معرف المرتجع", "الاتجاه", "المبلغ (قرش)", "الوقت"],
      rows: report.refunds.flatMap((refund) => refund.refundCashEvents.map((event) => [refund.returnId, cashDirectionAr(event.direction), event.amountPiasters, event.recordedAt])),
    },
    {
      nameAr: "تصحيحات المرتجعات",
      columnsAr: ["معرف المرتجع", "معرف التصحيح", "النوع", "المراجعة", "السبب", "معرف المنفذ", "اسم المنفذ", "الوقت"],
      rows: report.refunds.flatMap((refund) => refund.corrections.map((change) => [refund.returnId, change.id, correctionTypeAr(change.type), change.revision, change.reason, change.changedByStaffId, change.changedByDisplayName, change.changedAt])),
    },
    {
      nameAr: "المشتريات",
      columnsAr: ["معرف الاستلام", "التاريخ", "معرف الموظف", "الكمية الفعلية", "التكلفة الفعلية (قرش)"],
      rows: report.purchases.receipts.map((row) => [row.receiptId, row.receiptDate, row.receivedByStaffId, row.effectiveQuantity, row.effectiveCostPiasters]),
    },
    {
      nameAr: "تفاصيل المشتريات",
      columnsAr: ["معرف الاستلام", "معرف السطر", "كود المنتج", "اسم المنتج", "معرف المتغير", "المقاس", "اللون", "الكمية الفعلية", "تكلفة الوحدة (قرش)", "التكلفة الفعلية (قرش)"],
      rows: report.purchases.receipts.flatMap((receipt) => receipt.lines.map((line) => [receipt.receiptId, line.lineId, line.variant.product.code, line.variant.product.nameAr, line.variant.id, line.variant.size.nameAr, line.variant.color.nameAr, line.effectiveQuantity, line.effectiveUnitCostPiasters, line.effectiveCostPiasters])),
    },
    {
      nameAr: "تصحيحات المشتريات",
      columnsAr: ["معرف الاستلام", "معرف التصحيح", "المراجعة", "السبب", "معرف المنفذ", "اسم المنفذ", "الوقت"],
      rows: report.purchases.receipts.flatMap((receipt) => receipt.corrections.map((change) => [receipt.receiptId, change.id, change.revision, change.reason, change.changedByStaffId, change.changedByDisplayName, change.changedAt])),
    },
    {
      nameAr: "المصروفات",
      columnsAr: ["معرف المصروف", "الفرع", "الموظف", "معرف الموظف", "التاريخ", "المبلغ (قرش)", "التصنيف", "الوصف", "الحالة", "مراجعة التصحيح"],
      rows: report.expenses.items.map((row) => [row.expenseId, auditLabel(row.branch.nameAr, row.branch.id), row.createdByDisplayName, row.createdByStaffId, row.expenseDate, row.amountPiasters, row.categoryNameAr, row.description, effectiveStatusAr(row.effectiveStatus), row.correctionRevision]),
    },
    {
      nameAr: "تصحيحات المصروفات",
      columnsAr: ["معرف المصروف", "معرف التصحيح", "النوع", "المراجعة", "السبب", "معرف المنفذ", "اسم المنفذ", "الوقت"],
      rows: report.expenses.items.flatMap((expense) => expense.corrections.map((change) => [expense.expenseId, change.id, correctionTypeAr(change.type), change.revision, change.reason, change.changedByStaffId, change.changedByDisplayName, change.changedAt])),
    },
    {
      nameAr: "الأكثر مبيعاً",
      columnsAr: ["كود المنتج", "اسم المنتج", "وحدات البيع بعد الإلغاء", "الكمية المرتجعة"],
      rows: report.bestSellers.map((row) => [row.productCode, row.productNameAr, row.grossEffectiveSoldQuantity, row.returnedQuantity]),
    },
    {
      nameAr: "المخزون",
      columnsAr: ["البيان", "القيمة"],
      rows: [
        ["نطاق المخزون", "جميع الفروع"],
        ["الكمية المتاحة", report.inventory.availableQuantity],
        ["قيمة المتاح (قرش)", report.inventory.availableValuePiasters],
        ["الكمية المحمية", report.inventory.protectedQuantity],
        ["قيمة المحمي (قرش)", report.inventory.protectedValuePiasters],
        ["كمية بتكلفة غير محسومة", report.inventory.unresolvedCostQuantity],
        ["تكاليف غير مكتملة", yesNo(report.inventory.costsIncomplete)],
      ],
    },
    {
      nameAr: "الطلبات التشغيلية",
      columnsAr: ["الحالة", "العدد"],
      rows: [
        ["نطاق الحالات", "جميع الفروع"],
        ["قيد الانتظار", report.onlineOrderOperations.pendingCount],
        ["مؤكد", report.onlineOrderOperations.confirmedCount],
        ["تم الشحن", report.onlineOrderOperations.shippedCount],
        ["فشل التسليم", report.onlineOrderOperations.deliveryFailedCount],
      ],
    },
    {
      nameAr: "المخزون المنخفض",
      columnsAr: ["الفرع", "كود المنتج", "اسم المنتج", "المقاس", "اللون", "المتاح", "الحد", "مصدر الحد"],
      rows: report.lowStock.map((row) => [branchAuditLabel(report, row.branchId), row.variant.product.code, row.variant.product.nameAr, row.variant.size.nameAr, row.variant.color.nameAr, row.availableQuantity, row.threshold, thresholdSourceAr(row.thresholdSource)]),
    },
  ];
}

function yesNo(value: boolean): string {
  return value ? "نعم" : "لا";
}

function auditLabel(nameAr: string | undefined, id: string): string {
  return nameAr ? `${nameAr} (${id})` : id;
}

function branchAuditLabel(report: ManagementReportDto, branchId: string | null): string | null {
  if (!branchId) return null;
  const branch = report.byBranch.find((row) => row.branch.id === branchId)?.branch;
  return auditLabel(branch?.nameAr, branchId);
}

function periodKindAr(value: ManagementReportDto["period"]["kind"]): string {
  if (value === "today") return "اليوم";
  if (value === "day") return "يوم محدد";
  return "شهر";
}

function channelAr(value: "all" | "physical" | "online"): string {
  if (value === "all") return "كل القنوات";
  return value === "physical" ? "البيع داخل الفرع" : "المتجر الإلكتروني";
}

function sourceKindAr(value: "physical_sale" | "delivered_online_order", context: "sale" | "return" = "return"): string {
  return value === "physical_sale" ? "بيع داخل الفرع"
    : context === "sale" ? "طلب إلكتروني مؤكد" : "طلب إلكتروني مُسلَّم";
}

function effectiveStatusAr(value: "active" | "cancelled"): string {
  return value === "active" ? "ساري" : "ملغى";
}

function cashRefundStatusAr(value: "none" | "owed" | "paid" | "overpaid" | "cancelled"): string {
  switch (value) {
    case "none": return "لا يوجد";
    case "owed": return "مستحق";
    case "paid": return "مدفوع";
    case "overpaid": return "مدفوع بزيادة";
    case "cancelled": return "ملغى";
  }
}

function correctionTypeAr(value: "correction" | "cancellation"): string {
  return value === "correction" ? "تصحيح" : "إلغاء";
}

function cashDirectionAr(value: "paid_out" | "recovered"): string {
  return value === "paid_out" ? "مدفوع للعميل" : "مسترد من العميل";
}

function thresholdSourceAr(value: "global" | "variant"): string {
  return value === "global" ? "الحد العام" : "حد المتغير";
}

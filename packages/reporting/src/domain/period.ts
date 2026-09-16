import type { ManagementReportPeriodDto } from "@bravos/contracts";
import { ReportingValidationError } from "./errors.ts";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;

export type ReportingPeriod = ManagementReportPeriodDto & { from: Date; to: Date };

export function parseReportingPeriod(query: Record<string, unknown>, now: Date, exportMode = false): ReportingPeriod {
  const allowed = new Set(["period", "date", "month", "branchId", "channel", "employeeId",
    ...(exportMode ? [] : ["detailPage", "detailPageSize"])]);
  if (Object.keys(query).some((key) => !allowed.has(key))) throw new ReportingValidationError("مرشحات التقرير غير صالحة.");
  const kind = query.period;
  if (kind !== "today" && kind !== "day" && kind !== "month") {
    throw new ReportingValidationError("فترة التقرير غير صالحة.");
  }
  let fromDate: string;
  let toDate: string;
  let labelAr: string;
  if (kind === "today") {
    if (query.date !== undefined || query.month !== undefined) throw new ReportingValidationError("فترة اليوم لا تقبل تاريخاً إضافياً.");
    fromDate = cairoDateAt(now);
    toDate = addDays(fromDate, 1);
    labelAr = "اليوم";
  } else if (kind === "day") {
    if (typeof query.date !== "string" || query.month !== undefined) throw new ReportingValidationError("حدد تاريخ يوم التقرير.");
    fromDate = validDate(query.date);
    toDate = addDays(fromDate, 1);
    labelAr = fromDate;
  } else {
    if (typeof query.month !== "string" || query.date !== undefined) throw new ReportingValidationError("حدد شهر التقرير.");
    const match = MONTH.exec(query.month);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new ReportingValidationError("شهر التقرير غير صالح.");
    fromDate = `${match[1]}-${match[2]}-01`;
    toDate = addMonths(fromDate, 1);
    labelAr = query.month;
  }
  return {
    kind,
    labelAr,
    fromCairoDate: fromDate,
    toCairoDateInclusive: addDays(toDate, -1),
    from: cairoDateBoundary(fromDate),
    to: cairoDateBoundary(toDate),
  };
}

export function cairoDateAt(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function validDate(value: string): string {
  const match = DATE.exec(value);
  if (!match) throw new ReportingValidationError("تاريخ التقرير غير صالح.");
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new ReportingValidationError("تاريخ التقرير غير صالح.");
  }
  return value;
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function addMonths(value: string, months: number): string {
  const [year, month] = value.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10);
}

export function cairoDateBoundary(value: string): Date {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const wallUtc = Date.UTC(year, month - 1, day);
  let low = wallUtc - 48 * 60 * 60 * 1_000;
  let high = wallUtc + 48 * 60 * 60 * 1_000;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (cairoDateAt(new Date(middle)) >= value) high = middle;
    else low = middle + 1;
  }
  const boundary = new Date(low);
  if (cairoDateAt(boundary) !== value) throw new ReportingValidationError("تعذر تحديد بداية تاريخ القاهرة.");
  return boundary;
}

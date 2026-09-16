import { AnalyticsValidationError } from "./errors.ts";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_RANGE_DAYS = 366;
const BOUNDARY_SEARCH_WINDOW_MS = 48 * 60 * 60 * 1_000;
const CAIRO_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type AnalyticsPeriod = {
  fromCairoDate: string;
  toCairoDateInclusive: string;
  from: Date;
  toExclusive: Date;
};

export function parseAnalyticsPeriod(value: unknown): AnalyticsPeriod {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AnalyticsValidationError("فترة التحليلات غير صالحة.");
  }
  const query = value as Record<string, unknown>;
  if (Object.keys(query).some((key) => key !== "from" && key !== "to")) {
    throw new AnalyticsValidationError("مرشحات التحليلات غير صالحة.");
  }
  const fromCairoDate = validDate(query.from);
  const toCairoDateInclusive = validDate(query.to);
  const fromDay = utcDay(fromCairoDate);
  const toDay = utcDay(toCairoDateInclusive);
  const rangeDays = Math.floor((toDay.getTime() - fromDay.getTime()) / 86_400_000) + 1;
  if (rangeDays < 1 || rangeDays > MAX_RANGE_DAYS) {
    throw new AnalyticsValidationError("فترة التحليلات يجب أن تكون بين يوم واحد و366 يوماً.");
  }
  return {
    fromCairoDate,
    toCairoDateInclusive,
    from: cairoMidnight(fromCairoDate),
    toExclusive: cairoMidnight(addDays(toCairoDateInclusive, 1)),
  };
}

function validDate(value: unknown): string {
  if (typeof value !== "string") throw new AnalyticsValidationError("تاريخ التحليلات غير صالح.");
  const match = DATE.exec(value);
  if (!match) throw new AnalyticsValidationError("تاريخ التحليلات غير صالح.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new AnalyticsValidationError("تاريخ التحليلات غير صالح.");
  }
  return value;
}

function utcDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function cairoMidnight(value: string): Date {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const targetKey = dateKey(year, month, day);
  const wallUtc = Date.UTC(year, month - 1, day);
  let low = wallUtc - BOUNDARY_SEARCH_WINDOW_MS;
  let high = wallUtc + BOUNDARY_SEARCH_WINDOW_MS;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (cairoDateKey(new Date(middle)) < targetKey) low = middle + 1;
    else high = middle;
  }
  const boundary = new Date(low);
  if (cairoDateKey(boundary) !== targetKey) throw new Error("تعذر تحديد بداية يوم القاهرة.");
  return boundary;
}

function cairoDateKey(instant: Date): number {
  const parts = Object.fromEntries(
    CAIRO_DATE.formatToParts(instant)
      .filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
      .map((part) => [part.type, Number(part.value)]),
  );
  if (!parts.year || !parts.month || !parts.day) throw new Error("تعذر تحديد تاريخ القاهرة.");
  return dateKey(parts.year, parts.month, parts.day);
}

function dateKey(year: number, month: number, day: number): number {
  return year * 10_000 + month * 100 + day;
}

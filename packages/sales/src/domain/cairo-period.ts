/** Inclusive Cairo start and exclusive Cairo end for the calendar month or year containing `now`. */
export function cairoPeriod(now: Date, period: "month" | "year"): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("تعذر تحديد تاريخ القاهرة.");
  }
  if (period === "year") {
    return { from: `${year}-01-01`, to: `${year + 1}-01-01` };
  }
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return {
    from: `${year}-${String(month).padStart(2, "0")}-01`,
    to: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

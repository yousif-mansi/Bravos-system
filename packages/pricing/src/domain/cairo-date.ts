import { PricingValidationError } from "./errors.ts";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const cairoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function cairoDateAt(instant: Date): string {
  if (Number.isNaN(instant.getTime())) {
    throw new PricingValidationError("تاريخ تقييم العرض غير صالح.");
  }
  const parts = cairoDateFormatter.formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new PricingValidationError("تعذر تحديد تاريخ القاهرة.");
  }
  return `${year}-${month}-${day}`;
}

export function assertCairoDate(value: unknown, messageAr: string): string {
  if (typeof value !== "string") {
    throw new PricingValidationError(messageAr);
  }
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    throw new PricingValidationError(messageAr);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new PricingValidationError(messageAr);
  }
  return value;
}

export function offerIsActiveOn(
  offer: { active: boolean; startsOn: string; endsOn: string },
  cairoDate: string,
): boolean {
  return offer.active && offer.startsOn <= cairoDate && cairoDate <= offer.endsOn;
}

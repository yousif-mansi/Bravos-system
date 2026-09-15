import { StorefrontConfigValidationError } from "./errors.ts";

export type StorefrontContactPlatform = "whatsapp" | "facebook" | "instagram" | "tiktok";

const PLATFORM_HOSTS: Record<StorefrontContactPlatform, readonly string[]> = {
  whatsapp: ["wa.me", "whatsapp.com"],
  facebook: ["facebook.com", "fb.com"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
};

export function normalizeStorefrontContactUrl(
  platform: StorefrontContactPlatform,
  value: unknown,
  label: string,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new StorefrontConfigValidationError(`${label} غير صالح.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) {
    throw new StorefrontConfigValidationError(`${label} أطول من الحد المسموح.`);
  }
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol !== "https:"
      || !parsed.hostname
      || parsed.username
      || parsed.password
      || !PLATFORM_HOSTS[platform].some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))
    ) {
      throw new Error("invalid");
    }
    return parsed.toString();
  } catch {
    throw new StorefrontConfigValidationError(`${label} يجب أن يكون رابط HTTPS رسمياً بدون بيانات دخول.`);
  }
}

export function safeStorefrontContactUrl(platform: StorefrontContactPlatform, value: string | null | undefined): string | null {
  try {
    return normalizeStorefrontContactUrl(platform, value, "الرابط");
  } catch {
    return null;
  }
}

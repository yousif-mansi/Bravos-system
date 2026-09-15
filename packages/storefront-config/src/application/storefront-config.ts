import type { PublicStorefrontContactsDto, StorefrontContactsDto } from "@bravos/contracts";
import { ForbiddenError, isManager, UnauthenticatedError } from "@bravos/identity";
import { normalizeStorefrontContactUrl } from "../domain/contact-url.ts";
import { StorefrontConfigValidationError } from "../domain/errors.ts";
import type { StorefrontConfigActorPort, StorefrontContactsStore, VerifiedAuth } from "./ports.ts";

const CONTACT_KEYS = new Set(["whatsappUrl", "facebookUrl", "instagramUrl", "tiktokUrl"]);

export type StorefrontConfigServices = ReturnType<typeof createStorefrontConfigServices>;

export function createStorefrontConfigServices(ports: {
  actors: StorefrontConfigActorPort;
  contacts: StorefrontContactsStore;
}) {
  async function requireManager(auth: VerifiedAuth | null) {
    if (!auth) throw new UnauthenticatedError();
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) throw new UnauthenticatedError();
    if (!isManager(staff)) throw new ForbiddenError();
    return staff;
  }

  return {
    async publicContacts(): Promise<PublicStorefrontContactsDto> {
      return ports.contacts.getPublic();
    },

    async managerContacts(auth: VerifiedAuth | null): Promise<StorefrontContactsDto> {
      await requireManager(auth);
      return ports.contacts.getManager();
    },

    async updateContacts(auth: VerifiedAuth | null, input: unknown): Promise<StorefrontContactsDto> {
      const actor = await requireManager(auth);
      const value = asExactObject(input);
      return ports.contacts.update({
        whatsappUrl: normalizeStorefrontContactUrl("whatsapp", value.whatsappUrl, "رابط واتساب"),
        facebookUrl: normalizeStorefrontContactUrl("facebook", value.facebookUrl, "رابط فيسبوك"),
        instagramUrl: normalizeStorefrontContactUrl("instagram", value.instagramUrl, "رابط إنستجرام"),
        tiktokUrl: normalizeStorefrontContactUrl("tiktok", value.tiktokUrl, "رابط تيك توك"),
        actorStaffId: actor.id,
        at: new Date(),
      });
    },
  };
}

function asExactObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new StorefrontConfigValidationError("بيانات روابط المتجر غير صالحة.");
  }
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !CONTACT_KEYS.has(key))) {
    throw new StorefrontConfigValidationError("بيانات روابط المتجر تحتوي حقولاً غير مسموح بها.");
  }
  return value;
}

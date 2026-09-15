export type { PublicStorefrontContactsDto, StorefrontContactsDto } from "@bravos/contracts";
export { StorefrontConfigValidationError } from "./domain/errors.ts";
export { normalizeStorefrontContactUrl, type StorefrontContactPlatform } from "./domain/contact-url.ts";
export { createStorefrontConfigServices, type StorefrontConfigServices } from "./application/storefront-config.ts";
export type { OpeningStorefrontConfigTransaction, StorefrontConfigActorPort, StorefrontContactsStore, VerifiedAuth } from "./application/ports.ts";

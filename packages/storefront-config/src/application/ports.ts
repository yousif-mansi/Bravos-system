import type { PublicStorefrontContactsDto, StorefrontContactsDto } from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";

export type { VerifiedAuth };

export type StorefrontConfigActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
};

export type StorefrontContactsStore = {
  getPublic(): Promise<PublicStorefrontContactsDto>;
  getManager(): Promise<StorefrontContactsDto>;
  update(input: PublicStorefrontContactsDto & { actorStaffId: string; at: Date }): Promise<StorefrontContactsDto>;
};

import type { AutomaticOfferDto } from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";

export type { VerifiedAuth };

export type PricingActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
};

export type AutomaticOfferWrite = {
  id: string;
  nameAr: string;
  discountType: "percentage" | "fixed";
  percentageBasisPoints: number | null;
  fixedDiscountPiasters: number | null;
  startsOn: string;
  endsOn: string;
  active: boolean;
  allowCoupon: boolean;
  productIds: string[];
  categoryIds: string[];
  actorStaffId: string;
  changedAt: Date;
};

export type AutomaticOfferStore = {
  list(): Promise<AutomaticOfferDto[]>;
  getById(id: string): Promise<AutomaticOfferDto | null>;
  insert(input: AutomaticOfferWrite): Promise<AutomaticOfferDto>;
  update(input: AutomaticOfferWrite): Promise<AutomaticOfferDto | null>;
};

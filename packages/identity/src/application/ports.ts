import type { BranchCode, StaffRole } from "@bravos/contracts";
import type { AuthenticatedStaff, StaffGrant } from "../domain/authorization.ts";

export type VerifiedAuth = {
  staffId: string;
  sessionId: string;
};

export type BranchRecord = {
  id: string;
  code: BranchCode;
  nameAr: string;
};

export type GrantInput = {
  branchId: string;
  cashier: boolean;
  orderRepresentative: boolean;
};

export type CreateStaffInput = {
  loginName: string;
  displayName: string;
  password: string;
  role: StaffRole;
  isOwner?: boolean;
  grants: unknown;
};

export type IdentityProvider = {
  createAccount(input: {
    loginName: string;
    displayName: string;
    password: string;
    role: StaffRole;
    isOwner: boolean;
    grants: StaffGrant[];
    actorStaffId: string | null;
  }): Promise<{ id: string }>;
  hashPassword(password: string): Promise<string>;
};

export type StaffDirectory = {
  listBranches(): Promise<BranchRecord[]>;
  findByLoginName(loginName: string): Promise<AuthenticatedStaff | null>;
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
  listStaff(): Promise<AuthenticatedStaff[]>;
  replaceGrants(
    staffId: string,
    grants: StaffGrant[],
    actorStaffId: string,
  ): Promise<void>;
  resetPasswordAtomically(staffId: string, passwordHash: string, actorStaffId: string): Promise<void>;
  disableAtomically(staffId: string, actorStaffId: string): Promise<void>;
  getSessionBranch(sessionId: string): Promise<string | null>;
  setSessionBranch(sessionId: string, staffId: string, branchId: string | null): Promise<void>;
  saveRecoveryChallenge(input: {
    staffId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  completeRecoveryAtomically(input: {
    tokenHash: string;
    passwordHash: string;
    now: Date;
  }): Promise<{ staffId: string } | null>;
};

export type RecoveryOutbox = {
  readonly kind: "local-outbox" | "operator-file" | "unavailable";
  deliver(message: { purpose: "owner-recovery"; createdAt: string; token: string }): Promise<void>;
};

import type { BranchCode, StaffRole } from "@bravos/contracts";

export type StaffGrant = {
  branchId: string;
  branchCode: BranchCode;
  cashier: boolean;
  orderRepresentative: boolean;
};

export type StaffChange = {
  operation: "provision" | "reset_password" | "disable" | "replace_grants";
  actorStaffId: string | null;
  occurredAt: Date;
};

export type AuthenticatedStaff = {
  id: string;
  loginName: string;
  displayName: string;
  role: StaffRole;
  disabled: boolean;
  isOwner: boolean;
  grants: StaffGrant[];
  changedByStaffId: string | null;
  changedAt: Date;
  changes: StaffChange[];
};

export function isManager(staff: Pick<AuthenticatedStaff, "role">): boolean {
  return staff.role === "manager";
}

export function authorizedBranches(staff: AuthenticatedStaff): StaffGrant[] {
  if (isManager(staff)) {
    return staff.grants;
  }
  return staff.grants.filter((grant) => grant.cashier || grant.orderRepresentative);
}

export function canUseBranch(staff: AuthenticatedStaff, branchId: string): boolean {
  if (staff.disabled) {
    return false;
  }
  if (isManager(staff)) {
    return staff.grants.some((grant) => grant.branchId === branchId);
  }
  return authorizedBranches(staff).some((grant) => grant.branchId === branchId);
}

export function capabilitiesFor(staff: AuthenticatedStaff, branchId: string | null) {
  const manageStaff = isManager(staff);
  const manageCatalog = isManager(staff);
  const manageInventory = isManager(staff);
  if (!branchId) {
    return {
      cashier: false,
      orderRepresentative: false,
      manageStaff,
      manageCatalog,
      manageInventory,
    };
  }
  if (isManager(staff) && canUseBranch(staff, branchId)) {
    return {
      cashier: true,
      orderRepresentative: true,
      manageStaff,
      manageCatalog,
      manageInventory,
    };
  }
  const grant = staff.grants.find((item) => item.branchId === branchId);
  return {
    cashier: Boolean(grant?.cashier),
    orderRepresentative: Boolean(grant?.orderRepresentative),
    manageStaff,
    manageCatalog,
    manageInventory,
  };
}

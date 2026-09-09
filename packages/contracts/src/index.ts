export type BranchCode = "abshway" | "fayoum";

export type StaffRole = "manager" | "employee";

export type BranchDto = {
  id: string;
  code: BranchCode;
  nameAr: string;
};

export type StaffGrantDto = {
  branchId: string;
  cashier: boolean;
  orderRepresentative: boolean;
};

export type StaffSummaryDto = {
  id: string;
  loginName: string;
  displayName: string;
  role: StaffRole;
  disabled: boolean;
};

export type WorkspaceDto = {
  staff: StaffSummaryDto;
  authorizedBranches: BranchDto[];
  activeBranch: BranchDto | null;
  capabilities: {
    cashier: boolean;
    orderRepresentative: boolean;
    manageStaff: boolean;
  };
};

export type StaffChangeDto = {
  operation: "provision" | "reset_password" | "disable" | "replace_grants";
  actorStaffId: string | null;
  occurredAt: string;
};

export type StaffAccountDto = StaffSummaryDto & {
  grants: Array<StaffGrantDto & { branch: BranchDto }>;
  changedByStaffId: string | null;
  changedAt: string;
  changes: StaffChangeDto[];
};

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "DUPLICATE_LOGIN_NAME"
  | "BRANCH_NOT_AUTHORIZED"
  | "INVALID_RECOVERY"
  | "NOT_FOUND"
  | "ORIGIN_DENIED"
  | "CONFLICT";

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    messageAr: string;
  };
};

export const BRANCH_NAMES_AR: Record<BranchCode, string> = {
  abshway: "أبشواي",
  fayoum: "الفيوم",
};

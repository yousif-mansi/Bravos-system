import { BRANCH_NAMES_AR, type StaffAccountDto, type WorkspaceDto } from "@bravos/contracts";
import {
  authorizedBranches,
  capabilitiesFor,
  canUseBranch,
  isManager,
  type AuthenticatedStaff,
  type StaffGrant,
} from "../domain/authorization.ts";
import {
  assertDisplayName,
  assertLoginName,
  assertPassword,
  BranchNotAuthorizedError,
  DuplicateLoginNameError,
  ForbiddenError,
  IdentityValidationError,
  InvalidRecoveryError,
  NotFoundError,
  UnauthenticatedError,
} from "../domain/login-name.ts";
import type {
  CreateStaffInput,
  GrantInput,
  IdentityProvider,
  RecoveryOutbox,
  StaffDirectory,
  VerifiedAuth,
} from "./ports.ts";

export type IdentityServices = ReturnType<typeof createIdentityServices>;

const BRANCH_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createIdentityServices(ports: {
  identity: IdentityProvider;
  directory: StaffDirectory;
  recoveryOutbox: RecoveryOutbox;
  now?: () => Date;
}) {
  const now = ports.now ?? (() => new Date());

  async function requireStaff(auth: VerifiedAuth | null): Promise<{
    staff: AuthenticatedStaff;
    sessionId: string;
  }> {
    if (!auth) {
      throw new UnauthenticatedError();
    }
    const staff = await ports.directory.getStaff(auth.staffId);
    if (!staff || staff.disabled) {
      throw new UnauthenticatedError();
    }
    return { staff, sessionId: auth.sessionId };
  }

  async function requireManager(auth: VerifiedAuth | null) {
    const current = await requireStaff(auth);
    if (!isManager(current.staff)) {
      throw new ForbiddenError();
    }
    return current;
  }

  return {
    async workspace(auth: VerifiedAuth | null): Promise<WorkspaceDto> {
      const { staff, sessionId } = await requireStaff(auth);
      const activeBranchId = await ports.directory.getSessionBranch(sessionId);
      return toWorkspace(staff, activeBranchId);
    },

    async listStaff(auth: VerifiedAuth | null): Promise<StaffAccountDto[]> {
      await requireManager(auth);
      const staff = await ports.directory.listStaff();
      return staff.map(toStaffAccount);
    },

    async provisionStaff(auth: VerifiedAuth | null, input: CreateStaffInput): Promise<StaffAccountDto> {
      const { staff: actor } = await requireManager(auth);
      return this.createStaffRecord(input, {
        isOwner: false,
        role: "employee",
        actorStaffId: actor.id,
      });
    },

    async createStaffRecord(
      input: CreateStaffInput,
      options: { isOwner: boolean; role: CreateStaffInput["role"]; actorStaffId: string | null },
    ): Promise<StaffAccountDto> {
      const loginName = assertLoginName(input.loginName);
      const displayName = assertDisplayName(input.displayName);
      assertPassword(input.password);
      const grants = await normalizeGrants(ports.directory, input.grants, options.role);
      const existing = await ports.directory.findByLoginName(loginName);
      if (existing) {
        throw new DuplicateLoginNameError();
      }
      const created = await ports.identity.createAccount({
        loginName,
        displayName,
        password: input.password,
        role: options.role,
        isOwner: options.isOwner,
        grants,
        actorStaffId: options.actorStaffId,
      });
      const staff = await ports.directory.getStaff(created.id);
      if (!staff) {
        throw new NotFoundError();
      }
      return toStaffAccount(staff);
    },

    async resetPassword(auth: VerifiedAuth | null, staffId: string, password: string): Promise<void> {
      const { staff: actor } = await requireManager(auth);
      assertPassword(password);
      const staff = await ports.directory.getStaff(staffId);
      if (!staff) {
        throw new NotFoundError();
      }
      const passwordHash = await ports.identity.hashPassword(password);
      await ports.directory.resetPasswordAtomically(staffId, passwordHash, actor.id);
    },

    async disableStaff(auth: VerifiedAuth | null, staffId: string): Promise<void> {
      const { staff: actor } = await requireManager(auth);
      const staff = await ports.directory.getStaff(staffId);
      if (!staff) {
        throw new NotFoundError();
      }
      if (staff.isOwner) {
        throw new ForbiddenError("لا يمكن تعطيل حساب المالك.");
      }
      await ports.directory.disableAtomically(staffId, actor.id);
    },

    async setGrants(
      auth: VerifiedAuth | null,
      staffId: string,
      grantsInput: unknown,
    ): Promise<StaffAccountDto> {
      const { staff: actor } = await requireManager(auth);
      const staff = await ports.directory.getStaff(staffId);
      if (!staff) {
        throw new NotFoundError();
      }
      const grants = await normalizeGrants(ports.directory, grantsInput, staff.role);
      await ports.directory.replaceGrants(staffId, grants, actor.id);
      const updated = await ports.directory.getStaff(staffId);
      if (!updated) {
        throw new NotFoundError();
      }
      return toStaffAccount(updated);
    },

    async selectActiveBranch(auth: VerifiedAuth | null, branchId: string): Promise<WorkspaceDto> {
      const { staff, sessionId } = await requireStaff(auth);
      if (!canUseBranch(staff, branchId)) {
        throw new BranchNotAuthorizedError();
      }
      await ports.directory.setSessionBranch(sessionId, staff.id, branchId);
      return toWorkspace(staff, branchId);
    },

    async requestOwnerRecovery(loginName: string): Promise<void> {
      const normalized = assertLoginName(loginName);
      const staff = await ports.directory.findByLoginName(normalized);
      if (!staff?.isOwner || staff.disabled) {
        return;
      }
      const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const tokenHash = await hashToken(token);
      const expiresAt = new Date(now().getTime() + 30 * 60 * 1000);
      await ports.directory.saveRecoveryChallenge({
        staffId: staff.id,
        tokenHash,
        expiresAt,
      });
      await ports.recoveryOutbox.deliver({
        purpose: "owner-recovery",
        createdAt: now().toISOString(),
        token,
      });
    },

    async completeOwnerRecovery(token: string, newPassword: string): Promise<void> {
      assertPassword(newPassword);
      if (!/^[a-f0-9]{64}$/.test(token)) {
        throw new InvalidRecoveryError();
      }
      const tokenHash = await hashToken(token);
      const passwordHash = await ports.identity.hashPassword(newPassword);
      const claimed = await ports.directory.completeRecoveryAtomically({
        tokenHash,
        passwordHash,
        now: now(),
      });
      if (!claimed) {
        throw new InvalidRecoveryError();
      }
    },
  };
}

function parseGrantInput(value: unknown): GrantInput[] {
  if (!Array.isArray(value)) {
    throw new IdentityValidationError("شكل صلاحيات الفروع غير صالح.");
  }
  const allowed = new Set(["branchId", "cashier", "orderRepresentative"]);
  const parsed: GrantInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new IdentityValidationError("شكل صلاحيات الفروع غير صالح.");
    }
    const record = item as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!allowed.has(key)) {
        throw new IdentityValidationError("شكل صلاحيات الفروع غير صالح.");
      }
    }
    if (typeof record.branchId !== "string" || !BRANCH_ID_PATTERN.test(record.branchId)) {
      throw new IdentityValidationError("الفرع المحدد غير موجود.");
    }
    if (typeof record.cashier !== "boolean" || typeof record.orderRepresentative !== "boolean") {
      throw new IdentityValidationError("يجب تحديد صلاحية الكاشير أو ممثل الطلبات لكل فرع.");
    }
    parsed.push({
      branchId: record.branchId,
      cashier: record.cashier,
      orderRepresentative: record.orderRepresentative,
    });
  }
  return parsed;
}

async function normalizeGrants(
  directory: StaffDirectory,
  grantsInput: unknown,
  role: CreateStaffInput["role"],
): Promise<StaffGrant[]> {
  const branches = await directory.listBranches();
  if (role === "manager") {
    return branches.map((branch) => ({
      branchId: branch.id,
      branchCode: branch.code,
      cashier: true,
      orderRepresentative: true,
    }));
  }
  const grants = parseGrantInput(grantsInput);
  if (grants.length === 0) {
    throw new IdentityValidationError("يجب تعيين فرع واحد على الأقل للموظف.");
  }
  const normalized: StaffGrant[] = [];
  for (const grant of grants) {
    const branch = branches.find((item) => item.id === grant.branchId);
    if (!branch) {
      throw new IdentityValidationError("الفرع المحدد غير موجود.");
    }
    if (!grant.cashier && !grant.orderRepresentative) {
      throw new IdentityValidationError("يجب تحديد صلاحية الكاشير أو ممثل الطلبات لكل فرع.");
    }
    if (normalized.some((item) => item.branchId === grant.branchId)) {
      throw new IdentityValidationError("لا يمكن تكرار الفرع في الصلاحيات.");
    }
    normalized.push({
      branchId: branch.id,
      branchCode: branch.code,
      cashier: grant.cashier,
      orderRepresentative: grant.orderRepresentative,
    });
  }
  return normalized;
}

function toWorkspace(staff: AuthenticatedStaff, activeBranchId: string | null): WorkspaceDto {
  const branches = authorizedBranches(staff).map((grant) => ({
    id: grant.branchId,
    code: grant.branchCode,
    nameAr: BRANCH_NAMES_AR[grant.branchCode],
  }));
  const active = branches.find((branch) => branch.id === activeBranchId) ?? null;
  return {
    staff: {
      id: staff.id,
      loginName: staff.loginName,
      displayName: staff.displayName,
      role: staff.role,
      disabled: staff.disabled,
    },
    authorizedBranches: branches,
    activeBranch: active,
    capabilities: capabilitiesFor(staff, active?.id ?? null),
  };
}

function toStaffAccount(staff: AuthenticatedStaff): StaffAccountDto {
  return {
    id: staff.id,
    loginName: staff.loginName,
    displayName: staff.displayName,
    role: staff.role,
    disabled: staff.disabled,
    changedByStaffId: staff.changedByStaffId,
    changedAt: staff.changedAt.toISOString(),
    changes: staff.changes.map((change) => ({
      operation: change.operation,
      actorStaffId: change.actorStaffId,
      occurredAt: change.occurredAt.toISOString(),
    })),
    grants: staff.grants.map((grant) => ({
      branchId: grant.branchId,
      cashier: grant.cashier,
      orderRepresentative: grant.orderRepresentative,
      branch: {
        id: grant.branchId,
        code: grant.branchCode,
        nameAr: BRANCH_NAMES_AR[grant.branchCode],
      },
    })),
  };
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

import type { StaffAccountDto, WorkspaceDto } from "@bravos/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly messageAr: string,
  ) {
    super(messageAr);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? "CONFLICT",
      body?.error?.messageAr ?? "تعذر إكمال العملية.",
    );
  }
  return body as T;
}

export function signIn(loginName: string, password: string) {
  return request<{ user: { username?: string } }>("/api/auth/sign-in/username", {
    method: "POST",
    body: JSON.stringify({ username: loginName, password }),
  });
}

export function signOut() {
  return request("/api/auth/sign-out", { method: "POST", body: JSON.stringify({}) });
}

export function getWorkspace() {
  return request<WorkspaceDto>("/api/internal/workspace");
}

export function selectBranch(branchId: string) {
  return request<WorkspaceDto>("/api/internal/active-branch", {
    method: "POST",
    body: JSON.stringify({ branchId }),
  });
}

export function listStaff() {
  return request<StaffAccountDto[]>("/api/internal/staff");
}

export function createStaff(input: {
  loginName: string;
  displayName: string;
  password: string;
  grants: Array<{ branchId: string; cashier: boolean; orderRepresentative: boolean }>;
}) {
  return request<StaffAccountDto>("/api/internal/staff", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function resetStaffPassword(staffId: string, password: string) {
  return request(`/api/internal/staff/${staffId}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function disableStaff(staffId: string) {
  return request(`/api/internal/staff/${staffId}/disable`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function setStaffGrants(
  staffId: string,
  grants: Array<{ branchId: string; cashier: boolean; orderRepresentative: boolean }>,
) {
  return request<StaffAccountDto>(`/api/internal/staff/${staffId}/grants`, {
    method: "POST",
    body: JSON.stringify({ grants }),
  });
}

export function requestOwnerRecovery(loginName: string) {
  return request("/api/internal/owner-recovery/request", {
    method: "POST",
    body: JSON.stringify({ loginName }),
  });
}

export function completeOwnerRecovery(token: string, password: string) {
  return request("/api/internal/owner-recovery/complete", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

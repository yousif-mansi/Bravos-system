const LOGIN_NAME_PATTERN = /^[\p{L}\p{N}._-]+$/u;

export function normalizeLoginName(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

export function isAllowedLoginName(value: string): boolean {
  const normalized = normalizeLoginName(value);
  return normalized.length >= 3 && normalized.length <= 30 && LOGIN_NAME_PATTERN.test(normalized);
}

export function assertLoginName(value: string): string {
  const normalized = normalizeLoginName(value);
  if (!isAllowedLoginName(normalized)) {
    throw new IdentityValidationError("اسم الدخول غير صالح.");
  }
  return normalized;
}

export function assertDisplayName(value: string): string {
  const displayName = value.normalize("NFC").trim();
  if (displayName.length < 2 || displayName.length > 80) {
    throw new IdentityValidationError("الاسم الظاهر غير صالح.");
  }
  return displayName;
}

export function assertPassword(value: string): string {
  if (value.length < 8 || value.length > 128) {
    throw new IdentityValidationError("كلمة المرور يجب أن تكون بين 8 و128 حرفاً.");
  }
  return value;
}

export class IdentityValidationError extends Error {
  readonly code = "VALIDATION" as const;
  constructor(message: string) {
    super(message);
    this.name = "IdentityValidationError";
  }
}

export class DuplicateLoginNameError extends Error {
  readonly code = "DUPLICATE_LOGIN_NAME" as const;
  constructor() {
    super("اسم الدخول مستخدم بالفعل.");
    this.name = "DuplicateLoginNameError";
  }
}

export class UnauthenticatedError extends Error {
  readonly code = "UNAUTHENTICATED" as const;
  constructor() {
    super("يلزم تسجيل الدخول.");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN" as const;
  constructor(message = "لا تملك صلاحية تنفيذ هذه العملية.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class BranchNotAuthorizedError extends Error {
  readonly code = "BRANCH_NOT_AUTHORIZED" as const;
  constructor() {
    super("هذا الفرع غير مصرّح لحسابك.");
    this.name = "BranchNotAuthorizedError";
  }
}

export class InvalidRecoveryError extends Error {
  readonly code = "INVALID_RECOVERY" as const;
  constructor() {
    super("رمز الاسترداد غير صالح أو منتهٍ.");
    this.name = "InvalidRecoveryError";
  }
}

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  constructor(message = "العنصر غير موجود.") {
    super(message);
    this.name = "NotFoundError";
  }
}

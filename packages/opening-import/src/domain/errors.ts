export class OpeningImportValidationError extends Error { readonly code = "VALIDATION"; }
export class OpeningImportConflictError extends Error { readonly code = "OPERATION_CONFLICT"; }
export class OpeningImportStaleError extends Error { readonly code = "OPENING_IMPORT_STALE"; }

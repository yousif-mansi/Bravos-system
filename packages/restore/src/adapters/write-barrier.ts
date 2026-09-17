// The database write barrier raises this exception when a business write reaches PostgreSQL
// during a restore pause.
export function isRestorePausedDatabaseError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (error as { code?: unknown }).code === "P0001"
    && (error as { message?: unknown }).message === "BRAVOS_RESTORE_PAUSED";
}

export type PosUpdateDecision = "activate" | "defer";

export const POS_SCHEMA_VERSION = 4;

const SAFE_STEP_MIGRATIONS = new Set(["1->2", "2->3", "3->4"]);

export function isDeclaredSafeMigration(fromVersion: number, toVersion: number): boolean {
  if (!Number.isInteger(fromVersion) || !Number.isInteger(toVersion)) {
    return false;
  }
  if (toVersion === fromVersion) {
    return true;
  }
  if (toVersion < fromVersion) {
    return false;
  }
  for (let version = fromVersion; version < toVersion; version += 1) {
    if (!SAFE_STEP_MIGRATIONS.has(`${version}->${version + 1}`)) {
      return false;
    }
  }
  return true;
}

export function evaluatePosUpdate(input: {
  storedSchemaVersion: number;
  incomingSchemaVersion: number;
  incomingMigrationSafe: boolean;
}): PosUpdateDecision {
  if (!Number.isInteger(input.storedSchemaVersion) || !Number.isInteger(input.incomingSchemaVersion)) {
    return "defer";
  }
  if (input.incomingSchemaVersion === input.storedSchemaVersion) {
    return "activate";
  }
  if (input.incomingSchemaVersion < input.storedSchemaVersion) {
    return "defer";
  }
  if (!input.incomingMigrationSafe) {
    return "defer";
  }
  return "activate";
}

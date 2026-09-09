import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RecoveryOutbox } from "../application/ports.ts";

export function createLocalRecoveryOutbox(directory: string): RecoveryOutbox {
  return {
    kind: "local-outbox",
    async deliver(message) {
      await mkdir(directory, { recursive: true });
      const fileName = `owner-recovery-${message.createdAt.replaceAll(":", "-")}.json`;
      await writeFile(
        path.join(directory, fileName),
        `${JSON.stringify(message)}\n`,
        { encoding: "utf8", flag: "w" },
      );
      await writeFile(
        path.join(directory, "latest.json"),
        `${JSON.stringify(message)}\n`,
        { encoding: "utf8", flag: "w" },
      );
    },
  };
}

export function createUnavailableRecoveryOutbox(): RecoveryOutbox {
  return {
    kind: "unavailable",
    async deliver() {
      throw new Error("Owner recovery delivery is not configured.");
    },
  };
}

export function createOwnerRecoveryOutbox(input: {
  nodeEnv: string;
  adapter: string | undefined;
  directory: string | undefined;
}): RecoveryOutbox {
  const adapter = input.adapter ?? (input.nodeEnv === "production" ? undefined : "local-outbox");
  if (input.nodeEnv === "production") {
    throw new Error(
      "Owner recovery is fail-closed in production until a non-local delivery adapter is configured.",
    );
  }
  if (adapter !== "local-outbox") {
    throw new Error("Unknown owner recovery adapter.");
  }
  if (!input.directory) {
    throw new Error("BRAVOS_OWNER_RECOVERY_OUTBOX_DIR is required for the local outbox adapter.");
  }
  return createLocalRecoveryOutbox(input.directory);
}

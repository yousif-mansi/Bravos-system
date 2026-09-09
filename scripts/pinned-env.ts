import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpmBin = path.join(root, ".local", "tools", "node_modules", ".bin");
const nodeDir = "C:\\Program Files\\nodejs";

export function workspaceRoot(): string {
  return root;
}

export function pinnedProcessEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
    COREPACK_ENABLE_AUTO_PIN: "0",
    PATH: `${pnpmBin}${path.delimiter}${nodeDir}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

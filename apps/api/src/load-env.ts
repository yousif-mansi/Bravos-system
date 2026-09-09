import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveWorkspaceRoot(start = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return process.cwd();
}

export async function loadLocalEnv() {
  const file = path.join(resolveWorkspaceRoot(), ".local", "dev.env");
  try {
    const text = await readFile(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith("#") || !line.includes("=")) {
        continue;
      }
      const index = line.indexOf("=");
      const key = line.slice(0, index);
      const value = line.slice(index + 1);
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

import { execFileSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "apps/api/dist/main.js");

await mkdir(path.dirname(outfile), { recursive: true });
const external = [
  "pg",
  "better-auth",
  "better-auth/*",
  "fastify",
  "embedded-postgres",
  "sharp",
  "react",
  "@react-pdf/renderer",
  "@ayocore/exceljs",
];

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["apps/api/src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  packages: "bundle",
  external,
  sourcemap: true,
  logLevel: "info",
});

await cp(
  path.join(root, "packages/persistence/src/migrations"),
  path.join(root, "apps/api/dist/migrations"),
  { recursive: true },
);
await cp(
  path.join(root, "packages/report-export/assets"),
  path.join(root, "apps/api/dist/assets"),
  { recursive: true },
);

// Externals are loaded at runtime from the built API location, so each one must resolve from there.
for (const specifier of external.filter((name) => !name.includes("*"))) {
  try {
    execFileSync(process.execPath, ["--input-type=module", "-e", `import.meta.resolve(${JSON.stringify(specifier)})`], {
      cwd: path.dirname(outfile),
      stdio: "pipe",
    });
  } catch {
    throw new Error(`API runtime dependency ${specifier} does not resolve from ${path.relative(root, path.dirname(outfile))}.`);
  }
}

console.log(`API build wrote ${path.relative(root, outfile)}`);

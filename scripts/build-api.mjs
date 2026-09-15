import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "apps/api/dist/main.js");

await mkdir(path.dirname(outfile), { recursive: true });
await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["apps/api/src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  packages: "bundle",
  external: ["pg", "better-auth", "better-auth/*", "fastify", "embedded-postgres", "sharp"],
  sourcemap: true,
  logLevel: "info",
});

await cp(
  path.join(root, "packages/persistence/src/migrations"),
  path.join(root, "apps/api/dist/migrations"),
  { recursive: true },
);

console.log(`API build wrote ${path.relative(root, outfile)}`);

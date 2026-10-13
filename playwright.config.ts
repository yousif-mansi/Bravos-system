import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { pinnedProcessEnv } from "./scripts/pinned-env.ts";

const controlFile = path.resolve(".local", `e2e-control-${process.pid}-${randomBytes(12).toString("hex")}.json`);
process.env.BRAVOS_E2E_CONTROL_FILE = controlFile;
const env = pinnedProcessEnv({ BRAVOS_E2E_CONTROL_FILE: controlFile });

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalTeardown: "./scripts/e2e-teardown.ts",
  use: {
    ...devices["Desktop Chrome"],
    locale: "ar-EG",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "pnpm exec tsx scripts/e2e-stack.ts",
      url: "http://127.0.0.1:3011/api/public/health",
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env,
    },
    {
      command: "pnpm --filter @bravos/internal exec vite --host 127.0.0.1 --port 5174 --strictPort",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: pinnedProcessEnv({ BRAVOS_API_ORIGIN: "http://127.0.0.1:3011" }),
    },
    {
      command: "pnpm --filter @bravos/storefront exec next dev --hostname 127.0.0.1 --port 3001",
      url: "http://127.0.0.1:3001",
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: pinnedProcessEnv({
        BRAVOS_API_ORIGIN: "http://127.0.0.1:3011",
        BRAVOS_NEXT_DIST_DIR: ".next-e2e",
      }),
    },
  ],
});

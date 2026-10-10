import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { expect, test } from "@playwright/test";
import { pinnedProcessEnv, workspaceRoot } from "../../scripts/pinned-env.ts";

const PREVIEW_PORT = 5175;
const PREVIEW_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;

let preview: ChildProcess | undefined;

test.beforeAll(async () => {
  await waitForPortFree(PREVIEW_PORT);
  await runPinned("pnpm", ["--filter", "@bravos/internal", "build"]);
  preview = spawn(
    "pnpm",
    ["--filter", "@bravos/internal", "exec", "vite", "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"],
    {
      cwd: workspaceRoot(),
      env: pinnedProcessEnv({ BRAVOS_API_ORIGIN: "http://127.0.0.1:3011" }),
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    },
  );
  await waitForHttp(`${PREVIEW_ORIGIN}/`, 60_000);
});

test.afterAll(async () => {
  await stopPreview(preview);
  preview = undefined;
});

test("production login does not request staff-management until that route is visited", async ({
  page,
}) => {
  const requested = new Set<string>();
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes(".js")) {
      requested.add(url);
    }
  });

  await page.goto(`${PREVIEW_ORIGIN}/login`);
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  expect(staffManagementRequests(requested), "login must not download staff-management").toEqual([]);

  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  expect(staffManagementRequests(requested), "branch selection must not download staff-management").toEqual([]);

  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
  expect(staffManagementRequests(requested), "workspace must not download staff-management").toEqual([]);
  expect(chunkRequests(requested, "catalog-maintenance"), "workspace must not download catalog-maintenance").toEqual([]);
  expect(chunkRequests(requested, "receiving-stock"), "workspace must not download receiving-stock").toEqual([]);
  // Essential POS chunks may be service-worker precached after workspace readiness; they remain lazy for the login graph.
  expect(chunkRequests(requested, "cashier-sales"), "workspace must not download cashier-sales").toEqual([]);

  await page.getByRole("link", { name: "الموظفون" }).click();
  await expect(page.getByRole("heading", { name: "إدارة الموظفين" })).toBeVisible();
  expect(staffManagementRequests(requested).length).toBeGreaterThan(0);
  expect(chunkRequests(requested, "catalog-maintenance"), "staff route must not download catalog-maintenance").toEqual([]);

  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await page.getByRole("link", { name: "المنتجات" }).click();
  await expect(page.getByRole("heading", { name: "إدارة المنتجات" })).toBeVisible();
  expect(chunkRequests(requested, "catalog-maintenance").length).toBeGreaterThan(0);
  expect(chunkRequests(requested, "receiving-stock"), "catalog route must not download receiving-stock").toEqual([]);

  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();
  expect(chunkRequests(requested, "receiving-stock").length).toBeGreaterThan(0);
  expect(chunkRequests(requested, "cashier-sales"), "receiving route must not download cashier-sales").toEqual([]);

  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await page.getByRole("link", { name: "المبيعات" }).click();
  await expect(page.getByRole("heading", { name: "المبيعات", exact: true })).toBeVisible();
  expect(chunkRequests(requested, "cashier-sales").length).toBeGreaterThan(0);
});

function staffManagementRequests(requested: Set<string>): string[] {
  return chunkRequests(requested, "staff-management");
}

function chunkRequests(requested: Set<string>, name: string): string[] {
  return [...requested].filter((url) => url.includes(name));
}

function runPinned(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot(),
      env: pinnedProcessEnv(),
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
      }
    });
    child.on("error", reject);
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastError = "not started";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) {
        return;
      }
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function stopPreview(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid) {
    return;
  }
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      killer.on("exit", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function waitForPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  });
}

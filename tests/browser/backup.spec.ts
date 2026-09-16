import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page, type Route } from "@playwright/test";
import { BACKUP_SECTION_NAMES } from "@bravos/backup";
import { decodeBackupArchive } from "@bravos/backup/node";

const BACKUP_MAGIC = Buffer.from("BRAVOS-BACKUP\n1\n", "ascii");

test("manager sees the central-data warning and saves a usable verified encrypted backup", async ({ page }) => {
  await signIn(page, "owner", "e2e-owner-pass");
  const deviceId = randomUUID();
  const pendingOperationId = randomUUID();
  const snapshot = await staffApi(page, "POST", "/api/internal/sales/pos-snapshots", {
    deviceId,
    pendingOperationIds: [pendingOperationId],
  });
  expect(snapshot.status).toBe(201);

  await page.getByRole("link", { name: "نسخة احتياطية" }).click();
  await expect(page.getByRole("heading", { name: "نسخة احتياطية للبيانات" })).toBeVisible();
  await expect(page.getByText("أي مبيعات مكتملة ما زالت غير مرسلة")).toBeVisible();
  await expect(page.getByText("ملفات الصور نفسها غير موجودة داخل النسخة")).toBeVisible();
  await expect(page.getByText("هذه الشاشة للتنزيل فقط")).toBeVisible();
  const warning = page.getByTestId("backup-unsynchronized-warning");
  await expect(warning).toContainText(deviceId);
  await expect(warning).toContainText("عمليات معلّقة معروفة: 1");

  const form = page.getByRole("form", { name: "إنشاء نسخة احتياطية" });
  await form.getByLabel("كلمة حماية النسخة").fill("short");
  await form.getByLabel("تأكيد كلمة الحماية").fill("short");
  await form.getByRole("button", { name: "إنشاء وتنزيل النسخة" }).click();
  await expect(page.getByRole("alert").first()).toContainText("من 12 إلى 128 حرفاً");

  const backupPassword = "Bravos backup 26 passphrase";
  await form.getByLabel("كلمة حماية النسخة").fill(backupPassword);
  await form.getByLabel("تأكيد كلمة الحماية").fill(backupPassword);
  const responsePromise = page.waitForResponse((response) => (
    response.url().endsWith("/api/internal/backups")
      && response.request().method() === "POST"
      && response.status() === 201
  ));
  const downloadPromise = page.waitForEvent("download");
  await form.getByRole("button", { name: "إنشاء وتنزيل النسخة" }).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  const responseHeaders = response.headers();
  expect(responseHeaders["content-type"]).toContain("application/vnd.bravos.backup");
  expect(responseHeaders["content-disposition"]).toMatch(/attachment; filename="bravos-business-backup-.+\.bravos-backup"/);
  expect(responseHeaders["cache-control"]).toContain("no-store");
  expect(responseHeaders["x-content-type-options"]).toBe("nosniff");
  expect(responseHeaders["x-bravos-backup-format-version"]).toBe("1");
  expect(responseHeaders["x-bravos-backup-schema-version"]).toMatch(/^\d{3}_.+\.sql$/);
  expect(download.suggestedFilename()).toMatch(/^bravos-business-backup-.+\.bravos-backup$/);
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const bytes = await readFile(downloadedPath!);
  expect(bytes.subarray(0, BACKUP_MAGIC.length)).toEqual(BACKUP_MAGIC);
  expect(bytes.length).toBeGreaterThan(BACKUP_MAGIC.length + 32);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const decodedDownload = await decodeBackupArchive(bytes, backupPassword);
  expect(decodedDownload.manifest.sections.map((section) => section.name)).toEqual([...BACKUP_SECTION_NAMES]);
  expect(decodedDownload.manifest.knownUnsynchronizedTills.map((till) => till.deviceId)).toContain(deviceId);

  const details = page.locator('[aria-label="تفاصيل النسخة المنزلة"]');
  await expect(details).toContainText("تم التحقق من سلامة الملف وبدأ تنزيل النسخة");
  await expect(details).toContainText(checksum);
  await expect(details).toContainText("إجمالي السجلات");
  await expect(details).toContainText("المخزون والدفعات والتخصيصات");
  await expect(details).toContainText("الطلبات الأونلاين");
  await expect(details.getByTestId("backup-section-counts").locator(".backup-count")).toHaveCount(
    BACKUP_SECTION_NAMES.length,
  );
  await expect(form.getByLabel("كلمة حماية النسخة")).toHaveValue("");
  await expect(form.getByLabel("تأكيد كلمة الحماية")).toHaveValue("");

  const persistence = await readBrowserPersistence(page);
  expect(persistence.textValues.some((value) => value.includes(backupPassword))).toBe(false);
  expect(persistence.textValues.some((value) => (
    value.includes(checksum)
    || value.includes("BRAVOS-BACKUP\n1\n")
    || value.includes("QlJBVk9TLUJBQ0tVUAoxCg")
  ))).toBe(false);
  expect(persistence.binaryHashes).not.toContain(checksum);
  expect(persistence.cachedRequestUrls.filter((url) => new URL(url).pathname.startsWith("/api/internal/backups"))).toEqual([]);
});

test("backup UI and both backup endpoints stay private from an employee", async ({ page }) => {
  await signIn(page, "cashier", "e2e-cashier-pass");
  await expect(page.getByRole("link", { name: "نسخة احتياطية" })).toHaveCount(0);
  await page.goto("http://127.0.0.1:5174/backup");
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "نسخة احتياطية للبيانات" })).toHaveCount(0);
  const loadedResources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
  expect(loadedResources.some((url) => url.includes("manager-backup-") || url.includes("/BackupPage."))).toBe(false);

  const readiness = await staffApi(page, "GET", "/api/internal/backups/readiness");
  expect(readiness.status).toBe(403);
  expect(readiness.body).toMatchObject({ error: { code: "FORBIDDEN" } });
  const create = await staffApi(page, "POST", "/api/internal/backups", {
    password: "Employee cannot export this",
  });
  expect(create.status).toBe(403);
  expect(create.body).toMatchObject({ error: { code: "FORBIDDEN" } });
});

test("an account change cancels a late backup response before any file is saved", async ({ page }) => {
  await signIn(page, "owner", "e2e-owner-pass");
  await page.goto("http://127.0.0.1:5174/backup");
  await expect(page.getByRole("form", { name: "إنشاء نسخة احتياطية" })).toBeVisible();

  const archive = Buffer.concat([BACKUP_MAGIC, Buffer.from("{\"encrypted\":true}", "utf8")]);
  const checksum = createHash("sha256").update(archive).digest("hex");
  let releaseResponse!: () => void;
  const responseReleased = new Promise<void>((resolve) => { releaseResponse = resolve; });
  let markRequested!: () => void;
  const requested = new Promise<void>((resolve) => { markRequested = resolve; });
  let markRouteSettled!: () => void;
  const routeSettled = new Promise<void>((resolve) => { markRouteSettled = resolve; });
  await page.route("**/api/internal/backups", async (route) => {
    markRequested();
    await responseReleased;
    try {
      await safelyFulfillLateBackup(route, archive, checksum);
    } finally {
      markRouteSettled();
    }
  });

  await page.evaluate(() => {
    const state = window as typeof window & {
      backupObjectUrlCalls?: number;
      backupFetchSettled?: boolean;
    };
    state.backupObjectUrlCalls = 0;
    state.backupFetchSettled = false;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const isBackupCreate = new URL(url, window.location.href).pathname === "/api/internal/backups";
      try {
        return await originalFetch(...args);
      } finally {
        if (isBackupCreate) state.backupFetchSettled = true;
      }
    };
    const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      state.backupObjectUrlCalls = (state.backupObjectUrlCalls ?? 0) + 1;
      return originalCreateObjectUrl(object);
    };
  });
  const form = page.getByRole("form", { name: "إنشاء نسخة احتياطية" });
  await form.getByLabel("كلمة حماية النسخة").fill("Account switch backup password");
  await form.getByLabel("تأكيد كلمة الحماية").fill("Account switch backup password");
  await form.getByRole("button", { name: "إنشاء وتنزيل النسخة" }).click();
  await requested;

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("bravos-account", {
      detail: { eventId: crypto.randomUUID(), generation: 999, staffId: null },
    }));
  });
  await expect(page).toHaveURL(/\/login$/);
  releaseResponse();
  await routeSettled;
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as typeof window & { backupFetchSettled?: boolean }).backupFetchSettled,
  ))).toBe(true);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  expect(await page.evaluate(() => (
    (window as typeof window & { backupObjectUrlCalls?: number }).backupObjectUrlCalls ?? 0
  ))).toBe(0);
});

async function safelyFulfillLateBackup(route: Route, archive: Buffer, checksum: string) {
  const sectionCounts = Buffer.from(JSON.stringify(Object.fromEntries(
    BACKUP_SECTION_NAMES.map((name, index) => [name, index === 0 ? 1 : 0]),
  )), "utf8").toString("base64url");
  try {
    await route.fulfill({
      status: 201,
      contentType: "application/vnd.bravos.backup",
      headers: {
        "content-disposition": 'attachment; filename="bravos-business-backup-late.bravos-backup"',
        "x-bravos-backup-id": randomUUID(),
        "x-bravos-backup-format-version": "1",
        "x-bravos-backup-created-at": "2026-09-16T12:00:00.000Z",
        "x-bravos-backup-schema-version": "028_public_analytics.sql",
        "x-bravos-backup-total-record-count": "1",
        "x-bravos-backup-section-counts": sectionCounts,
        "x-bravos-backup-known-unsynchronized-till-count": "0",
        "x-bravos-backup-includes-unsent-browser-records": "false",
        "x-bravos-backup-includes-image-binaries": "false",
        "x-bravos-backup-sha256": checksum,
      },
      body: archive,
    });
  } catch {
    /* Fetch cancellation after the account change is the expected outcome. */
  }
}

async function signIn(page: Page, loginName: string, password: string) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await Promise.all([
    page.waitForURL(/\/workspace$/),
    page.getByRole("button", { name: "أبشواي" }).click(),
  ]);
}

async function staffApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: {
      origin: "http://127.0.0.1:5174",
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    data: payload,
  });
  const contentType = response.headers()["content-type"] ?? "";
  return {
    status: response.status(),
    body: contentType.includes("application/json") ? await response.json() : null,
  };
}

async function readBrowserPersistence(page: Page): Promise<{
  textValues: string[];
  binaryHashes: string[];
  cachedRequestUrls: string[];
}> {
  return page.evaluate(async () => {
    const textValues: string[] = [];
    const binaryHashes: string[] = [];
    const cachedRequestUrls: string[] = [];
    const seen = new WeakSet<object>();
    const recordBuffer = async (buffer: ArrayBuffer) => {
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      binaryHashes.push(Array.from(
        new Uint8Array(digest),
        (item) => item.toString(16).padStart(2, "0"),
      ).join(""));
    };
    const recordValue = async (value: unknown): Promise<void> => {
      if (typeof value === "string") {
        textValues.push(value);
        return;
      }
      if (value instanceof Blob) {
        await recordBuffer(await value.arrayBuffer());
        return;
      }
      if (value instanceof ArrayBuffer) {
        await recordBuffer(value);
        return;
      }
      if (ArrayBuffer.isView(value)) {
        const bytes = new Uint8Array(value.byteLength);
        bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        await recordBuffer(bytes.buffer);
        return;
      }
      if (!value || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      if (value instanceof Map) {
        for (const [key, nested] of value) {
          await recordValue(key);
          await recordValue(nested);
        }
        return;
      }
      if (value instanceof Set) {
        for (const nested of value) await recordValue(nested);
        return;
      }
      for (const [key, nested] of Object.entries(value)) {
        textValues.push(key);
        await recordValue(nested);
      }
    };

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) await recordValue([key, localStorage.getItem(key) ?? ""]);
    }
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key) await recordValue([key, sessionStorage.getItem(key) ?? ""]);
    }
    for (const database of await indexedDB.databases()) {
      if (!database.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(database.name!);
        open.onerror = () => reject(open.error ?? new Error(`تعذر فتح ${database.name}`));
        open.onsuccess = () => resolve(open.result);
      });
      try {
        for (const storeName of Array.from(db.objectStoreNames)) {
          const values = await new Promise<unknown[]>((resolve, reject) => {
            const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
            request.onerror = () => reject(request.error ?? new Error(`تعذر قراءة ${storeName}`));
            request.onsuccess = () => resolve(request.result);
          });
          await recordValue(values);
        }
      } finally {
        db.close();
      }
    }
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        cachedRequestUrls.push(request.url);
        const response = await cache.match(request);
        if (!response) throw new Error(`تعذر قراءة ${request.url}`);
        await recordBuffer(await response.arrayBuffer());
      }
    }
    return { textValues, binaryHashes, cachedRequestUrls };
  });
}

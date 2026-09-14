import { expect, test } from "@playwright/test";

test("employee signs in through the staff gateway and selects an authorized branch", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.evaluate(async () => {
    localStorage.setItem("bravos-offline-queue", "keep-me");
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("bravos-offline", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("queue");
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
  await expect(page.getByRole("link", { name: "الموظفون" })).toHaveCount(0);
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  const preserved = await page.evaluate(() => localStorage.getItem("bravos-offline-queue"));
  expect(preserved).toBe("keep-me");
  const dbStillThere = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const request = indexedDB.open("bravos-offline", 1);
        request.onsuccess = () => {
          const exists = request.result.objectStoreNames.contains("queue");
          request.result.close();
          resolve(exists);
        };
        request.onerror = () => resolve(false);
      }),
  );
  expect(dbStillThere).toBe(true);
});

test("manager creates a two-branch employee through the staff UI", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await page.getByRole("link", { name: "الموظفون" }).click();
  await expect(page.getByRole("heading", { name: "إدارة الموظفين" })).toBeVisible();
  const createForm = page.getByRole("form", { name: "إنشاء حساب موظف" });
  await createForm.getByLabel("اسم الدخول").fill("both.branches");
  await createForm.getByLabel("الاسم الظاهر").fill("موظف الفرعين");
  await createForm.getByLabel("كلمة المرور").fill("e2e-both-pass");
  await createForm.getByRole("checkbox", { name: "أبشواي", exact: true }).check();
  await createForm.getByRole("checkbox", { name: "الفيوم", exact: true }).check();
  await createForm.getByRole("checkbox", { name: "كاشير لأبشواي", exact: true }).check();
  await createForm.getByRole("checkbox", { name: "ممثل الطلبات للفيوم", exact: true }).check();
  await createForm.getByRole("button", { name: "إنشاء الحساب" }).click();
  await expect(page.getByRole("heading", { name: "الحسابات" }).locator("..").getByText("موظف الفرعين", { exact: true })).toBeVisible();
  const createdCard = page.locator("article.staff-item").filter({ hasText: "موظف الفرعين" });
  await expect(createdCard.getByText("أبشواي", { exact: true })).toBeVisible();
  await expect(createdCard.getByText("الفيوم", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  await page.getByLabel("اسم الدخول").fill("both.branches");
  await page.getByLabel("كلمة المرور").fill("e2e-both-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await expect(page.getByRole("button", { name: "أبشواي" })).toBeVisible();
  await expect(page.getByRole("button", { name: "الفيوم" })).toBeVisible();
  await page.getByRole("button", { name: "الفيوم" }).click();
  await expect(page.getByTestId("active-branch")).toContainText("الفيوم");
  await expect(page.getByRole("link", { name: "الموظفون" })).toHaveCount(0);
  await page.getByRole("link", { name: "تغيير الفرع" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
});

test("public entry has no staff screens or navigation", async ({ page }) => {
  await page.goto("http://127.0.0.1:3001/");
  await expect(page.getByRole("heading", { name: "برافوس" })).toBeVisible();
  await expect(page.getByText("المدخل العام", { exact: true })).toBeVisible();
  await expect(page.getByText("شاشات داخلية")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "تسجيل الدخول" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "الموظفون" })).toHaveCount(0);
  await page.goto("http://127.0.0.1:3001/staff");
  await expect(page.getByRole("heading", { name: "إدارة الموظفين" })).toHaveCount(0);
});

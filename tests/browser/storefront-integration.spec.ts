import { expect, test, type Page } from "@playwright/test";

const STAFF = "http://127.0.0.1:5174";
const STORE = "http://127.0.0.1:3001";

// playwright.config.ts starts a fresh PostgreSQL cluster through e2e-stack.ts.
// All catalog and stock changes below use that isolated stack's staff APIs.
test("public quantity caps at one branch's stock and anonymous return lookup stays private", async ({ page, request }) => {
  const fixture = await setup(page);
  const product = await createProduct(page, fixture.suffix, "CAP");
  const variantId = product.body.variants[0].id;
  await receive(page, fixture.a, variantId, 2);
  await receive(page, fixture.b, variantId, 3);
  const publicProduct = await publicApi(page, "GET", `/api/public/catalog/products/${product.body.id}`);
  expect(publicProduct.status).toBe(200);
  expect(publicProduct.body.variants[0].availableQuantity).toBe(3);
  expectPublicSafe(publicProduct.body);

  await page.goto(`${STORE}/products/${product.body.id}`);
  const panel = page.locator(".purchase-panel");
  await expect(panel.getByLabel("Quantity")).toHaveAttribute("max", "3");
  await panel.getByLabel("Quantity").fill("4");
  await expect(panel.getByRole("button", { name: "Add to bag" })).toBeDisabled();
  const excessiveQuote = await publicApi(page, "POST", "/api/public/checkout/quote", {
    deliveryAreaId: fixture.areaId, lines: [{ variantId, quantity: 4 }],
  });
  expect(excessiveQuote.status).toBe(409);
  expect(excessiveQuote.body.error.code).toBe("INSUFFICIENT_STOCK");
  await panel.getByLabel("Quantity").fill("3");
  await panel.getByRole("button", { name: "Add to bag" }).click();
  await expect(panel.getByRole("status")).toContainText("Added to your bag.");
  await page.goto(`${STORE}/cart`);
  await expect(page.locator(".cart-line output")).toHaveText("3");
  await expect(page.getByRole("button", { name: "Increase quantity" })).toBeDisabled();
  expect((await savedCart(page)).items).toMatchObject([{ variantId, quantity: 3, knownAvailableQuantity: 3 }]);

  // The request fixture has its own empty cookie jar, unlike page.request.
  const denied = await request.get(`${STAFF}/api/internal/returns/sources-page?phone=01012345678`, {
    headers: { origin: STAFF },
  });
  expect(denied.status()).toBe(401);
  expect(await denied.json()).toEqual({ error: { code: "UNAUTHENTICATED", messageAr: expect.any(String) } });
});

test("individually available products cannot quote a split basket and customer inputs survive repair", async ({ page }) => {
  const fixture = await setup(page);
  const x = await createProduct(page, fixture.suffix, "SPLIT-X");
  const y = await createProduct(page, fixture.suffix, "SPLIT-Y");
  await receive(page, fixture.a, x.body.variants[0].id, 1);
  await receive(page, fixture.b, y.body.variants[0].id, 1);
  await addProduct(page, x.body.id);
  await addProduct(page, y.body.id);
  await page.goto(`${STORE}/checkout`);
  await fillCustomer(page, fixture.areaId);
  const before = (await savedCart(page)).items;
  const failed = page.waitForResponse((response) => response.url().endsWith("/api/public/checkout/quote"));
  await checkout(page).getByRole("button", { name: "Review price" }).click();
  const response = await failed;
  expect(response.status()).toBe(409);
  expect((await response.json()).error.code).toBe("INSUFFICIENT_STOCK");
  await expect(page.locator('.checkout-message[role="alert"]')).toContainText("These choices cannot all be supplied together");
  await expect(checkout(page).getByRole("button", { name: "Place order request" })).toHaveCount(0);
  await expectCustomer(page, fixture.areaId);
  expect((await savedCart(page)).items).toEqual(before);
  await expect(page.getByRole("complementary", { name: "Your items" })).toContainText(y.body.nameAr);

  await receive(page, fixture.a, y.body.variants[0].id, 1);
  await reviewSuccessfully(page);
  await expectCustomer(page, fixture.areaId);
  expect((await savedCart(page)).items).toEqual(before);
  await checkout(page).getByRole("button", { name: "Place order request" }).click();
  await expect(page.getByRole("heading", { name: "Order request received" })).toBeVisible();
  const accepted = await page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-checkout-v1") ?? "null"));
  expect(accepted.request).toMatchObject({
    alternatePhone: "01212345678",
    landmark: "بجوار المكتبة",
    notes: "الاتصال قبل التوصيل",
  });
  expectPublicSafe(accepted.result);
  const replay = await publicApi(page, "POST", "/api/public/checkout/orders", accepted.request);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(accepted.result);
  expectPublicSafe(replay.body);
});

test("a basket losing its common branch after review rejects submission without an order and can be reviewed again", async ({ page }) => {
  const fixture = await setup(page);
  const x = await createProduct(page, fixture.suffix, "STALE-X");
  const y = await createProduct(page, fixture.suffix, "STALE-Y");
  await receive(page, fixture.a, x.body.variants[0].id, 1);
  await receive(page, fixture.a, y.body.variants[0].id, 1);
  await receive(page, fixture.b, y.body.variants[0].id, 1);
  await addProduct(page, x.body.id);
  await addProduct(page, y.body.id);
  await page.goto(`${STORE}/checkout`);
  await fillCustomer(page, fixture.areaId);
  await reviewSuccessfully(page);
  const beforeCart = (await savedCart(page)).items;
  const beforeOrders = await staffApi(page, "GET", "/api/internal/online-orders");
  expect(beforeOrders.status).toBe(200);
  const sold = await staffApi(page, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), employeeDiscountPiasters: 0,
    physicallyCompleted: true, lines: [{ variantId: y.body.variants[0].id, quantity: 1 }],
  });
  expect(sold.status).toBe(201);
  for (const product of [x, y]) {
    const current = await publicApi(page, "GET", `/api/public/catalog/products/${product.body.id}`);
    expect(current.body.variants[0]).toMatchObject({ availableQuantity: 1, orderable: true });
  }
  const rejected = page.waitForResponse((response) => response.url().endsWith("/api/public/checkout/orders"));
  await checkout(page).getByRole("button", { name: "Place order request" }).click();
  const response = await rejected;
  expect(response.status()).toBe(409);
  expect((await response.json()).error.code).toBe("INSUFFICIENT_STOCK");
  await expect(page.locator('.checkout-message[role="alert"]')).toContainText("These choices cannot all be supplied together");
  await expect(checkout(page).getByRole("button", { name: "Place order request" })).toHaveCount(0);
  await expectCustomer(page, fixture.areaId);
  expect((await savedCart(page)).items).toEqual(beforeCart);
  expect(await page.evaluate(() => localStorage.getItem("bravos-guest-checkout-v1"))).toBeNull();
  expect((await staffApi(page, "GET", "/api/internal/online-orders")).body).toEqual(beforeOrders.body);

  await receive(page, fixture.a, y.body.variants[0].id, 1);
  await reviewSuccessfully(page);
  await expectCustomer(page, fixture.areaId);
  await checkout(page).getByRole("button", { name: "Place order request" }).click();
  await expect(page.getByRole("heading", { name: "Order request received" })).toBeVisible();
  const accepted = await page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-checkout-v1") ?? "null"));
  expect(accepted.request).toMatchObject({
    alternatePhone: "01212345678",
    landmark: "بجوار المكتبة",
    notes: "الاتصال قبل التوصيل",
  });
  const afterOrders = await staffApi(page, "GET", "/api/internal/online-orders");
  expect(afterOrders.body).toHaveLength(beforeOrders.body.length + 1);
  expect(afterOrders.body.filter((order: { id: string }) => order.id === accepted.result.orderId)).toHaveLength(1);
});

test("hiding a sparse variant pair refreshes it unavailable in the cart while POS retains both original pairs", async ({ page }) => {
  const fixture = await setup(page);
  const product = await createProduct(page, fixture.suffix, "SPARSE", true);
  const hidden = product.body.variants.find((variant: { size: { id: string; nameAr: string }; color: { id: string; nameAr: string } }) => (
    variant.size.id === product.write.variants[0].sizeId && variant.color.id === product.write.variants[0].colorId
  ));
  if (!hidden) throw new Error("Expected the sparse pair that will be hidden.");
  const visible = product.body.variants.find((variant: { id: string; color: { nameAr: string } }) => variant.id !== hidden.id);
  if (!visible) throw new Error("Expected the sparse pair that stays visible.");
  await receive(page, fixture.a, hidden.id, 2);
  await receive(page, fixture.a, visible.id, 1);
  const published = await publicApi(page, "GET", `/api/public/catalog/products/${product.body.id}`);
  expect(published.status).toBe(200);
  const orderable = (published.body.variants as Array<{ id: string; orderable: boolean }>).filter((variant) => variant.orderable);
  expect(orderable.length).toBeGreaterThan(0);
  const initial = orderable[0]!;
  expect([hidden.id, visible.id]).toContain(initial.id);
  const alternate = initial.id === hidden.id ? visible : hidden;
  await page.goto(`${STORE}/products/${product.body.id}`);
  const panel = page.locator(".purchase-panel");
  const colors = panel.getByRole("group", { name: "Color" });
  const sizes = panel.getByRole("group", { name: "Size" });
  await expect(panel.locator("input[type='radio']")).toHaveCount(3);
  await expect(colors.getByRole("radio")).toHaveCount(2);
  await expect(sizes.getByRole("radio")).toHaveCount(1);
  await expect(sizes.getByRole("radio")).toHaveValue(initial.id);
  await expect(panel.locator(`input[value="${alternate.id}"]`)).toHaveCount(0);
  await colors.getByRole("radio", { name: alternate.color.nameAr }).check();
  await expect(sizes.getByRole("radio")).toHaveCount(1);
  await expect(sizes.getByRole("radio")).toHaveValue(alternate.id);
  await expect(panel.locator(`input[value="${initial.id}"]`)).toHaveCount(0);
  await colors.getByRole("radio", { name: hidden.color.nameAr }).check();
  await expect(sizes.getByRole("radio")).toHaveValue(hidden.id);
  await expect(panel.locator(`input[value="${visible.id}"]`)).toHaveCount(0);
  await panel.getByRole("button", { name: "Add to bag" }).click();
  await expect(panel.getByRole("status")).toContainText("Added to your bag.");
  const edited = await staffApi(page, "PATCH", `/api/internal/catalog/products/${product.body.id}`, {
    ...product.write,
    variants: product.write.variants.map((variant, index) => ({ ...variant, onlineVisible: index !== 0 })),
  });
  expect(edited.status).toBe(200);
  await page.reload();
  const remainingColors = panel.getByRole("group", { name: "Color" });
  const remainingSizes = panel.getByRole("group", { name: "Size" });
  await expect(panel.locator("input[type='radio']")).toHaveCount(2);
  const colorChoice = remainingColors.getByRole("radio");
  const sizeChoice = remainingSizes.getByRole("radio");
  await expect(colorChoice).toHaveCount(1);
  await expect(colorChoice).toBeVisible();
  await expect(colorChoice).toBeEnabled();
  await expect(colorChoice).toBeChecked();
  await expect(sizeChoice).toHaveCount(1);
  await expect(sizeChoice).toBeVisible();
  await expect(sizeChoice).toBeEnabled();
  await expect(sizeChoice).toBeChecked();
  await expect(sizeChoice).toHaveValue(visible.id);
  await expect(panel.locator(`input[value="${hidden.id}"]`)).toHaveCount(0);
  const add = panel.getByRole("button", { name: "Add to bag" });
  await expect(add).toHaveCount(1);
  await expect(add).toBeVisible();
  await expect(add).toBeEnabled();
  await page.goto(`${STORE}/cart`);
  await expect(page.locator(".cart-line")).toHaveCount(1);
  await expect(page.locator(".cart-line [role=alert]")).toContainText("This selection is unavailable right now");
  expect((await savedCart(page)).items).toMatchObject([{ variantId: hidden.id, quantity: 1, orderable: false }]);
  const pos = await staffApi(page, "GET", "/api/internal/catalog/pos-snapshot");
  expect(pos.status).toBe(200);
  const posProduct = pos.body.find((item: { id: string }) => item.id === product.body.id);
  expect(posProduct.variants).toHaveLength(2);
  expect(posProduct.variants).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: hidden.id, availableQuantity: 2 }),
    expect.objectContaining({ id: visible.id, availableQuantity: 1 }),
  ]));
});

async function setup(page: Page) {
  await page.goto(`${STAFF}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("active-branch")).toHaveText("أبشواي");
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  const branches = workspace.body.authorizedBranches as Array<{ id: string; code: string }>;
  const a = branches.find((branch) => branch.code === "abshway")!.id;
  const b = branches.find((branch) => branch.code === "fayoum")!.id;
  expect(workspace.body.activeBranch.id).toBe(a);
  const suffix = crypto.randomUUID().slice(0, 8);
  const area = await staffApi(page, "POST", "/api/internal/delivery-areas", {
    nameAr: `منطقة التكامل ${suffix}`, feePiasters: 2000, active: true,
  });
  expect(area.status).toBe(201);
  return { a, b, suffix, areaId: area.body.id as string };
}

async function createProduct(page: Page, suffix: string, label: string, sparse = false) {
  const code = `${label}-${suffix}`;
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${code}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `M ${code}` });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `أسود ${code}` });
  for (const response of [category, size, color]) expect(response.status).toBe(201);
  const variants = [{ sizeId: size.body.id as string, colorId: color.body.id as string, sellingPricePiastersOverride: null, onlineVisible: true }];
  if (sparse) {
    const otherSize = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `L ${code}` });
    const otherColor = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `رملي ${code}` });
    expect(otherSize.status).toBe(201);
    expect(otherColor.status).toBe(201);
    variants.push({ sizeId: otherSize.body.id, colorId: otherColor.body.id, sellingPricePiastersOverride: null, onlineVisible: true });
  }
  const write = {
    code, nameAr: `قميص ${code}`, descriptionAr: "منتج اختبار تكامل المتجر", categoryId: category.body.id,
    defaultSellingPricePiasters: 25000, publication: "available", imageRefs: [], sizeGuideAr: null, variants,
  };
  const created = await staffApi(page, "POST", "/api/internal/catalog/products", write);
  expect(created.status).toBe(201);
  return { ...created, write };
}

async function receive(page: Page, branchId: string, variantId: string, quantity: number) {
  const received = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId,
    receiptDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    lines: [{ variantId, quantity, unitCostPiasters: 10000 }],
  });
  expect(received.status).toBe(201);
}

async function addProduct(page: Page, productId: string) {
  await page.goto(`${STORE}/products/${productId}`);
  await page.locator(".purchase-panel").getByRole("button", { name: "Add to bag" }).click();
  await expect(page.locator(".purchase-panel").getByRole("status")).toContainText("Added to your bag.");
}

const CUSTOMER = {
  "Name": "عميل تكامل المتجر", "Primary mobile number": "01012345678", "Detailed address": "الفيوم، شارع الاختبار، منزل ١",
  "Alternate number (optional)": "01212345678", "Landmark (optional)": "بجوار المكتبة", "Notes (optional)": "الاتصال قبل التوصيل",
};

async function fillCustomer(page: Page, areaId: string) {
  const form = checkout(page);
  const optionalDetails = form.locator("details").filter({
    has: form.page().locator("summary", { hasText: "Optional delivery details" }),
  });
  if (!await optionalDetails.evaluate((element) => (element as HTMLDetailsElement).open)) {
    await optionalDetails.locator("summary").click();
  }
  for (const [label, value] of Object.entries(CUSTOMER)) await form.getByRole("textbox", { name: label, exact: true }).fill(value);
  await form.getByLabel("Delivery").selectOption(areaId);
}

async function expectCustomer(page: Page, areaId: string) {
  for (const [label, value] of Object.entries(CUSTOMER)) await expect(checkout(page).getByRole("textbox", { name: label, exact: true })).toHaveValue(value);
  await expect(checkout(page).getByLabel("Delivery")).toHaveValue(areaId);
}

async function reviewSuccessfully(page: Page) {
  const quoted = page.waitForResponse((response) => response.url().endsWith("/api/public/checkout/quote"));
  await checkout(page).getByRole("button", { name: "Review price" }).click();
  const response = await quoted;
  expect(response.status()).toBe(200);
  expectPublicSafe(await response.json());
  await expect(page.getByRole("region", { name: "Price details" })).toBeVisible();
  await expect(checkout(page).getByRole("button", { name: "Place order request" })).toBeVisible();
}

// Inspect keys recursively so fixture names/descriptions cannot trigger false positives.
// Public DTOs may contain selling prices and acknowledged order IDs, but no staff,
// fulfillment branch, cost allocation, or customer-history facts.
function expectPublicSafe(value: unknown, path = "response") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => expectPublicSafe(item, `${path}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      expect(key, `${path}.${key} must stay private`).not.toMatch(
        /cost|profit|batch|allocation|staff|employee|branch|inventoryValue|customer|primaryPhone|alternatePhone|detailedAddress|landmark|notes|history/i,
      );
      expectPublicSafe(nested, `${path}.${key}`);
    }
  }
}

function checkout(page: Page) { return page.getByRole("form", { name: "Checkout" }); }
async function savedCart(page: Page) { return page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-cart-v1") ?? "null")); }

async function staffApi(page: Page, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) {
  return api(page, STAFF, method, url, payload);
}
async function publicApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  return api(page, STORE, method, url, payload);
}
async function api(page: Page, origin: string, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) {
  const response = await page.request.fetch(`${origin}${url}`, {
    method, headers: { origin, ...(payload ? { "content-type": "application/json" } : {}) }, data: payload,
  });
  return { status: response.status(), body: await response.json() };
}

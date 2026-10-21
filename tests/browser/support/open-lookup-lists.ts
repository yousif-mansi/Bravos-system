import type { Locator, Page } from "@playwright/test";

/** Opens the POS size/color list disclosure when this scope contains #lookupSize. */
export async function openLookupLists(scope: Page | Locator) {
  const details = scope.locator("details:has(#lookupSize)");
  const target = details.first();
  await target.waitFor({ state: "attached" });
  if (await target.evaluate((element: HTMLDetailsElement) => element.open)) return;
  await target.locator("summary").click();
}

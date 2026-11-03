import { expect, test } from "vitest";
import { cartWithinSharedPool, lineQuantityCap, productQuantity, sharedPoolLimit } from "../../apps/storefront/app/cart/shared-pool.ts";

const pool = 4;

function line(variantId: string, quantity: number, available = pool) {
  return {
    productId: "shirt",
    variantId,
    quantity,
    knownAvailableQuantity: available,
    orderable: available > 0,
  };
}

test("options of one item share one quantity and cannot add up past it", () => {
  const black = line("black", 2);
  const white = line("white", 2);
  expect(sharedPoolLimit([black, white], "shirt")).toBe(pool);
  expect(productQuantity([black, white], "shirt")).toBe(4);
  expect(lineQuantityCap([black, white], "black")).toBe(2);
  expect(lineQuantityCap([black, white], "white")).toBe(2);
  expect(cartWithinSharedPool([black, white])).toBe(true);
  expect(cartWithinSharedPool([black, line("white", 3)])).toBe(false);
  expect(lineQuantityCap([black, line("white", 3)], "white")).toBe(2);
});

test("a second item keeps its own pool", () => {
  const items = [line("black", 4), { ...line("trousers", 1, 2), productId: "trousers" }];
  expect(cartWithinSharedPool(items)).toBe(true);
  expect(productQuantity(items, "shirt")).toBe(4);
  expect(productQuantity(items, "trousers")).toBe(1);
});

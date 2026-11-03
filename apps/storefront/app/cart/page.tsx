"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PublicProductDto } from "@bravos/contracts/public";
import { useCart } from "./cart-provider";
import { CartLine } from "./cart-line";
import { cartWithinSharedPool, lineQuantityCap } from "./shared-pool";
import { CartSummary } from "./cart-summary";
import styles from "./cart.module.css";

export default function CartPage() {
  const cart = useCart();
  const validated = useRef(false);
  const [checking, setChecking] = useState(false);
  const [availabilityNotice, setAvailabilityNotice] = useState({ text: "", failed: false });
  const total = cart.items.reduce((sum, item) => sum + item.unitPricePiasters * item.quantity, 0);

  useEffect(() => {
    if (!cart.hydrated || validated.current) return;
    validated.current = true;
    void revalidateCart();
  }, [cart.hydrated]);

  async function revalidateCart() {
    const before = cart.items;
    if (before.length === 0) return;
    setChecking(true);
    setAvailabilityNotice({ text: "", failed: false });
    try {
      const productIds = [...new Set(before.map((item) => item.productId))];
      const products = await Promise.all(productIds.map(async (productId) => {
        const response = await fetch(`/api/public/catalog/products/${encodeURIComponent(productId)}`, { cache: "no-store" });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("availability");
        return response.json() as Promise<PublicProductDto>;
      }));
      const byId = new Map(products.filter((product): product is PublicProductDto => Boolean(product)).map((product) => [product.id, product]));
      let changed = false;
      for (const item of before) {
        const product = byId.get(item.productId);
        const variant = product?.variants.find((candidate) => candidate.id === item.variantId);
        const next = variant && product ? {
          productId: product.id,
          productNameAr: product.nameAr,
          sizeNameAr: variant.size.nameAr,
          colorNameAr: variant.color.nameAr,
          unitPricePiasters: variant.sellingPricePiasters,
          imageRef: product.imageRefs[0] ?? null,
          knownAvailableQuantity: variant.availableQuantity,
          orderable: variant.orderable,
        } : {
          knownAvailableQuantity: 0,
          orderable: false,
        };
        if (
          next.knownAvailableQuantity !== item.knownAvailableQuantity
          || next.orderable !== item.orderable
          || ("unitPricePiasters" in next && next.unitPricePiasters !== item.unitPricePiasters)
        ) changed = true;
        await cart.refreshLine(item.variantId, next);
      }
      setAvailabilityNotice({
        text: changed
          ? "Product details were updated. Review the changes and notices before you continue."
          : "Product details checked. Review the final total at checkout.",
        failed: false,
      });
    } catch {
      setAvailabilityNotice({
        text: "Stock couldn't be checked right now. Try again before continuing your order.",
        failed: true,
      });
    } finally {
      setChecking(false);
    }
  }

  const heading = (
    <div className={`page-title ${styles.heading}`}>
      <h1>Bag</h1>
      <p>{!cart.hydrated || cart.storageStatus === "ready"
        ? "Review your selections, then add delivery details to see the final price."
        : "You can use the bag now, but these selections are saved only on this page for now."}</p>
    </div>
  );

  if (!cart.hydrated) {
    return <main id="main-content" className={`cart-page ${styles.page}`}>{heading}<div key="hydrating" className={styles.hydrating} role="status"><h2>Preparing your bag</h2><p>One moment… restoring the items saved in this browser.</p></div></main>;
  }

  return (
    <main id="main-content" className={`cart-page ${styles.page}`}>
      {heading}
      {cart.storageStatus === "unavailable" ? (
        <p className={styles.storageWarning} role="alert">This browser can't save the bag right now. These selections will be lost if you close or reload the page.</p>
      ) : null}
      {cart.storageStatus === "corrupt" ? (
        <p className={styles.storageWarning} role="alert">The saved bag couldn't be read. The original data was left unchanged, and this bag works only for now.</p>
      ) : null}
      {cart.items.length > 0 || availabilityNotice.text ? <div key="availability" className={styles.statusSlot}>
        <p className={`cart-status ${styles.status}${availabilityNotice.failed ? ` ${styles.errorStatus}` : ""}`} role="status">{availabilityNotice.text || (checking ? "Checking product details and prices…" : "Review product details and prices before you continue.")}</p>
      </div> : null}
      {cart.items.length === 0 ? (
        <div className={`empty-state ${styles.empty}`}>
          <p className={styles.emptyMark} aria-hidden="true">BRAVOS</p>
          <h2>Your bag is empty</h2>
          <p>Choose a product, size, and color to add it here. Adding products to your bag does not reserve stock.</p>
          <Link className="button-link" href="/">Browse products</Link>
        </div>
      ) : (
        <div className={styles.layout}>
          <section className={styles.lines} aria-label="Bag items">
            {cart.items.map((item) => (
              <CartLine
                key={item.variantId}
                item={item}
                lineCap={lineQuantityCap(cart.items, item.variantId)}
                onQuantityChange={(variantId, quantity, maximum) => void cart.setQuantity(variantId, quantity, maximum)}
                onRemove={(variantId) => void cart.remove(variantId)}
              />
            ))}
          </section>
          <CartSummary
            itemCount={cart.itemCount}
            merchandiseTotal={total}
            checking={checking}
            canCheckout={cartWithinSharedPool(cart.items)}
            onRefresh={() => void revalidateCart()}
          />
        </div>
      )}
    </main>
  );
}

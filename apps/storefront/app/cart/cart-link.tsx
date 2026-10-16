"use client";

import Link from "next/link";
import { BagPreview } from "./bag-preview";
import { useCart } from "./cart-provider";

export function CartLink() {
  const { hydrated, itemCount, storageStatus } = useCart();
  const count = hydrated ? itemCount : 0;
  return (
    <>
      <Link href="/cart">
        Bag <span className="cart-count" aria-label={`${count} ${count === 1 ? "item" : "items"} in bag`}>{count}</span>
        {hydrated && storageStatus !== "ready" ? <span className="cart-storage-indicator" aria-label="Bag not saved">!</span> : null}
      </Link>
      <BagPreview />
    </>
  );
}

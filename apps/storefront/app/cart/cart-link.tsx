"use client";

import Link from "next/link";
import { useCart } from "./cart-provider";

export function CartLink() {
  const { hydrated, itemCount, storageStatus } = useCart();
  return (
    <Link href="/cart">
      السلة <span className="cart-count" aria-label={`${hydrated ? itemCount : 0} قطع في السلة`}>{hydrated ? itemCount : 0}</span>
      {hydrated && storageStatus !== "ready" ? <span className="cart-storage-indicator" aria-label="السلة غير محفوظة">!</span> : null}
    </Link>
  );
}

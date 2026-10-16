import type { Metadata } from "next";
import Link from "next/link";
import { informationPageMetadata } from "../storefront-metadata";
import styles from "../customer-info.module.css";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return informationPageMetadata("shipping");
}

export default function ShippingPage() {
  return (
    <main id="main-content" lang="en" dir="ltr" className={styles.page}>
      <h1>Shipping</h1>
      <p>Pay on delivery. Your reviewed checkout total includes the delivery fee for your selected area.</p>
      <h2>Areas and fees</h2>
      <p>Choose from the available delivery areas at checkout to see the current fee.</p>
      <h2>Before confirmation</h2>
      <p>Your order starts as a request. Placing it does not reserve the items. A Bravos representative contacts you on WhatsApp to confirm availability.</p>
      <p>We check the whole bag during the price review and again before confirmation. If something is unavailable, we discuss it with you on WhatsApp before confirming.</p>
      <p className={styles.related}>
        <Link href="/returns">Returns</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/checkout">Checkout</Link>
      </p>
    </main>
  );
}

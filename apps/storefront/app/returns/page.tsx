import type { Metadata } from "next";
import Link from "next/link";
import { informationPageMetadata } from "../storefront-metadata";
import styles from "../customer-info.module.css";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return informationPageMetadata("returns");
}

export default function ReturnsPage() {
  return (
    <main id="main-content" lang="en" dir="ltr" className={styles.page}>
      <h1>Returns</h1>
      <p>To discuss a return, contact Bravos within 14 days of receiving your items. For in-store purchases, the period starts when the sale is completed; for online purchases, it starts on delivery.</p>
      <h2>Arrange a return</h2>
      <p>Bring the items to a Bravos branch, or contact us on WhatsApp before arranging your own courier. Staff inspect the items before processing a return.</p>
      <p>A WhatsApp message starts the conversation; it does not by itself complete a return or refund.</p>
      <h2>After 14 days</h2>
      <p>For a defect reported later, contact Bravos on WhatsApp to discuss your case.</p>
      <p className={styles.related}>
        <Link href="/contact">Contact</Link>
        <Link href="/shipping">Shipping</Link>
      </p>
    </main>
  );
}

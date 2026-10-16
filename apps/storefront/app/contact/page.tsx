import type { Metadata } from "next";
import Link from "next/link";
import { getPublicContacts } from "../public-catalog";
import { informationPageMetadata } from "../storefront-metadata";
import styles from "../customer-info.module.css";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return informationPageMetadata("contact");
}

const CONTACT_LINKS = [
  { key: "whatsappUrl", label: "WhatsApp" },
  { key: "facebookUrl", label: "Facebook" },
  { key: "instagramUrl", label: "Instagram" },
  { key: "tiktokUrl", label: "TikTok" },
] as const;

export default async function ContactPage() {
  const contacts = await getPublicContacts();
  const links = CONTACT_LINKS.flatMap((item) => {
    const href = contacts[item.key];
    return href ? [{ label: item.label, href }] : [];
  });

  return (
    <main id="main-content" lang="en" dir="ltr" className={styles.page}>
      <h1>Contact</h1>
      <p>No account is needed to shop. After you place an order request, our team confirms it on WhatsApp.</p>
      <h2>Contact Bravos</h2>
      {links.length > 0 ? (
        <ul className={styles.links}>
          {links.map((item) => (
            <li key={item.label}><a href={item.href} target="_blank" rel="noreferrer">{item.label}</a></li>
          ))}
        </ul>
      ) : (
        <p className={styles.fallback} role="status">No contact links are available right now. Please check back later.</p>
      )}
      <p className={styles.related}>
        <Link href="/shipping">Shipping</Link>
        <Link href="/returns">Returns</Link>
      </p>
    </main>
  );
}

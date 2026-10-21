import { Suspense } from "react";
import Link from "next/link";
import { getPublicContacts } from "../public-catalog";

type ContactLink = { label: string; href: string };

const CONTACT_FIELDS = [
  { key: "whatsappUrl", label: "WhatsApp" },
  { key: "facebookUrl", label: "Facebook" },
  { key: "instagramUrl", label: "Instagram" },
  { key: "tiktokUrl", label: "TikTok" },
] as const;

export function StoreFooter() {
  return (
    <footer className="store-footer">
      <div className="footer-identity">
        <img className="footer-brand" src="/brand/02_Logo_Horizontal_Ivory.svg" alt="Bravos" width={140} height={59} />
        <p className="footer-place">Menswear in Fayoum.</p>
      </div>
      <div className="footer-links">
        <nav aria-label="Customer information">
          <Link href="/shipping">Shipping</Link>
          <Link href="/returns">Returns</Link>
          <Link href="/contact">Contact</Link>
        </nav>
        <Suspense fallback={<ContactLinkList links={[]} pending />}>
          <ContactLinkSlot />
        </Suspense>
      </div>
    </footer>
  );
}

async function ContactLinkSlot() {
  const contacts = await getPublicContacts();
  const links = CONTACT_FIELDS.flatMap((item) => {
    const href = contacts[item.key];
    return href ? [{ label: item.label, href }] : [];
  });
  return <ContactLinkList links={links} />;
}

function ContactLinkList({ links, pending = false }: { links: ContactLink[]; pending?: boolean }) {
  return (
    <nav aria-label="Contact links" className="footer-contact-slot" aria-busy={pending ? true : undefined} data-contact-state={pending ? "pending" : links.length > 0 ? "ready" : "empty"}>
      {links.length > 0 ? links.map((item) => (
        <a href={item.href} key={item.label} target="_blank" rel="noreferrer">{item.label}</a>
      )) : pending ? null : (
        <p className="footer-contact-status">No contact link is available.</p>
      )}
    </nav>
  );
}

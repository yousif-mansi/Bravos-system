import type { ReactNode } from "react";
import Link from "next/link";
import { CartLink } from "./cart/cart-link";
import { CartProvider } from "./cart/cart-provider";
import { getPublicContacts } from "./public-catalog";
import "./globals.css";

export const metadata = {
  title: "برافوس | ملابس رجالي",
  description: "متجر برافوس للملابس الرجالي في الفيوم",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const contacts = await getPublicContacts();
  const contactLinks = [
    { label: "واتساب", href: contacts.whatsappUrl },
    { label: "فيسبوك", href: contacts.facebookUrl },
    { label: "إنستجرام", href: contacts.instagramUrl },
    { label: "تيك توك", href: contacts.tiktokUrl },
  ].filter((item): item is { label: string; href: string } => Boolean(item.href));

  return (
    <html lang="ar" dir="rtl" data-scroll-behavior="smooth">
      <body>
        <CartProvider>
          <a className="skip-link" href="#main-content">انتقل إلى المحتوى</a>
          <div className="store-shell">
            <header className="store-header">
              <Link className="wordmark" href="/" aria-label="برافوس — الصفحة الرئيسية">BRAVOS</Link>
              <nav className="store-nav" aria-label="التنقل الرئيسي">
                <Link href="/">المتجر</Link>
                <CartLink />
              </nav>
            </header>
            {children}
            <footer className="store-footer">
              <div>
                <strong className="footer-brand">برافوس</strong>
                <p>ملابس رجالي مختارة بعناية في الفيوم.</p>
              </div>
              {contactLinks.length > 0 ? (
                <nav aria-label="روابط التواصل">
                  {contactLinks.map((item) => (
                    <a href={item.href} key={item.label} target="_blank" rel="noreferrer">{item.label}</a>
                  ))}
                </nav>
              ) : null}
            </footer>
          </div>
        </CartProvider>
      </body>
    </html>
  );
}

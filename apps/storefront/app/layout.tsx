import type { ReactNode } from "react";
import Link from "next/link";
import { Cairo } from "next/font/google";
import { CartLink } from "./cart/cart-link";
import { CartProvider } from "./cart/cart-provider";
import { getPublicContacts } from "./public-catalog";
import { StorefrontVisitAnalytics } from "./storefront-analytics";
import "./globals.css";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata = {
  title: "برافوس | ملابس رجالي",
  description: "متجر برافوس للملابس الرجالي في الفيوم",
  icons: { icon: "/favicon.svg" },
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
    <html lang="ar" dir="rtl" data-scroll-behavior="smooth" className={cairo.className}>
      <body>
        <CartProvider>
          <StorefrontVisitAnalytics />
          <a className="skip-link" href="#main-content">انتقل إلى المحتوى</a>
          <div className="store-shell">
            <header className="store-header">
              <Link className="wordmark" href="/" aria-label="برافوس">
                <img src="/brand/02_Logo_Horizontal_Black.svg" alt="" width={168} height={71} />
              </Link>
              <nav className="store-nav" aria-label="التنقل الرئيسي">
                <Link href="/">المتجر</Link>
                <CartLink />
              </nav>
            </header>
            {children}
            <footer className="store-footer">
              <div>
                <img className="footer-brand" src="/brand/04_Wordmark_Black.svg" alt="برافوس" width={140} height={28} />
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

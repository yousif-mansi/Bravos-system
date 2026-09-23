import type { ReactNode } from "react";
import { Cairo } from "next/font/google";
import { CartProvider } from "./cart/cart-provider";
import { StoreFooter } from "./components/store-footer";
import { StoreHeader } from "./components/store-header";
import { getPublicContacts } from "./public-catalog";
import { StorefrontVisitAnalytics } from "./storefront-analytics";
import "./globals.css";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-cairo",
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
    <html lang="ar" dir="rtl" data-scroll-behavior="smooth" className={`${cairo.className} ${cairo.variable}`}>
      <body>
        <CartProvider>
          <StorefrontVisitAnalytics />
          <a className="skip-link" href="#main-content">انتقل إلى المحتوى</a>
          <div className="store-shell">
            <StoreHeader />
            {children}
            <StoreFooter contactLinks={contactLinks} />
          </div>
        </CartProvider>
      </body>
    </html>
  );
}

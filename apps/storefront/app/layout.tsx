import type { ReactNode } from "react";
import localFont from "next/font/local";
import { CartProvider } from "./cart/cart-provider";
import { CheckoutDraftProvider } from "./checkout/checkout-draft";
import { StoreFooter } from "./components/store-footer";
import { StoreHeader } from "./components/store-header";
import { getPublicContacts } from "./public-catalog";
import { StorefrontVisitAnalytics } from "./storefront-analytics";
import "./globals.css";

const commerce = localFont({ src: [
  { path: "./fonts/thmanyahsans-Regular.otf", weight: "400", style: "normal" },
  { path: "./fonts/thmanyahsans-Medium.otf", weight: "500", style: "normal" },
  { path: "./fonts/thmanyahsans-Bold.otf", weight: "700", style: "normal" },
], variable: "--font-thmanyah-sans", display: "swap" });
const editorial = localFont({ src: [
  { path: "./fonts/thmanyahserifdisplay-Regular.otf", weight: "400", style: "normal" },
  { path: "./fonts/thmanyahserifdisplay-Bold.otf", weight: "700", style: "normal" },
], variable: "--font-thmanyah-editorial", display: "swap", preload: false });
const display = localFont({ src: "./fonts/Androgy Demo.ttf", weight: "400", variable: "--font-androgy", display: "swap", preload: false });

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
    <html lang="ar" dir="rtl" data-scroll-behavior="smooth" className={`${commerce.variable} ${editorial.variable} ${display.variable}`}>
      <body>
        <CartProvider>
          <CheckoutDraftProvider>
            <StorefrontVisitAnalytics />
            <a className="skip-link" href="#main-content">انتقل إلى المحتوى</a>
            <div className="store-shell">
              {process.env.NODE_ENV !== "production" && process.env.BRAVOS_STOREFRONT_DEMO === "1" ? <p className="demo-notice" role="status">معاينة تجريبية — المنتجات والطلبات هنا للاختبار فقط</p> : null}
              <StoreHeader />
              {children}
              <StoreFooter contactLinks={contactLinks} />
            </div>
          </CheckoutDraftProvider>
        </CartProvider>
      </body>
    </html>
  );
}

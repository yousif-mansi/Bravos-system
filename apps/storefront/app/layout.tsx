import type { ReactNode } from "react";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { CartProvider } from "./cart/cart-provider";
import { CheckoutDraftProvider } from "./checkout/checkout-draft";
import { AmbientScene } from "./components/ambient-scene";
import { StoreFooter } from "./components/store-footer";
import { StoreHeader } from "./components/store-header";
import { StorefrontVisitAnalytics } from "./storefront-analytics";
import { rootMetadata } from "./storefront-metadata";
import "./globals.css";

const clash = localFont({
  src: "./fonts/ClashDisplay-Variable.woff2",
  weight: "200 700",
  style: "normal",
  variable: "--font-clash-display",
  display: "swap",
  // Clash has no Arabic. The generated size-adjust fallback is Arial and sits
  // ahead of Rose, so Arabic never reaches Rose. Latin preload stays on.
  adjustFontFallback: false,
});
const rose = localFont({
  src: [
    { path: "./fonts/Rose-ruzaiq-Regular.otf", weight: "400", style: "normal" },
    { path: "./fonts/Rose-ruzaiq-Medium.otf", weight: "500", style: "normal" },
    { path: "./fonts/Rose-ruzaiq-Bold.otf", weight: "700", style: "normal" },
  ],
  variable: "--font-rose",
  display: "swap",
  preload: false,
});

export function generateMetadata(): Metadata {
  return rootMetadata();
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" data-scroll-behavior="smooth" className={`${clash.variable} ${rose.variable}`}>
      <body>
        <AmbientScene />
        <CartProvider>
          <CheckoutDraftProvider>
            <StorefrontVisitAnalytics />
            <a className="skip-link" href="#main-content">Skip to content</a>
            <div className="store-shell">
              {process.env.NODE_ENV !== "production" && process.env.BRAVOS_STOREFRONT_DEMO === "1" ? <p className="demo-notice" role="status">Preview — products and orders here are for testing only</p> : null}
              <StoreHeader />
              {children}
              <StoreFooter />
            </div>
          </CheckoutDraftProvider>
        </CartProvider>
      </body>
    </html>
  );
}

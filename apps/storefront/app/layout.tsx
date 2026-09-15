import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "برافوس",
  description: "المدخل العام لمتجر برافوس",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <div className="store-shell">
          <header className="store-header">
            <div>
              <p className="eyebrow">ملابس رجالي في الفيوم</p>
              <Link href="/" style={{ textDecoration: "none" }}><strong>برافوس</strong></Link>
            </div>
            <p className="muted">المخزون موحّد بين فرعي أبشواي والفيوم</p>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}

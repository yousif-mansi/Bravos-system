import type { ReactNode } from "react";

export const metadata = {
  title: "برافوس",
  description: "المدخل العام لمتجر برافوس",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          margin: 0,
          fontFamily: "Segoe UI, Tahoma, Arial, sans-serif",
          background: "#f8f5f1",
          color: "#1f1a16",
        }}
      >
        {children}
      </body>
    </html>
  );
}

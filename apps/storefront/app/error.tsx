"use client";

export default function StorefrontError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ padding: "3rem 0" }}>
      <h1>تعذر تحميل المنتجات</h1>
      <p>حاول مرة أخرى بعد قليل.</p>
      <button type="button" onClick={reset}>إعادة المحاولة</button>
    </main>
  );
}

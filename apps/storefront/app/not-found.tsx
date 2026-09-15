import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ padding: "3rem 0" }}>
      <h1>المنتج غير موجود</h1>
      <p>قد يكون المنتج غير منشور حالياً.</p>
      <Link href="/">العودة إلى المنتجات</Link>
    </main>
  );
}

import Link from "next/link";
import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <main id="main-content" style={{ padding: "3rem 0" }}>
      <h1>المنتج غير موجود</h1>
      <p>قد يكون المنتج غير منشور حالياً.</p>
      <Link className={styles.returnLink} href="/">العودة إلى المنتجات</Link>
    </main>
  );
}

import Link from "next/link";
import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <main id="main-content" style={{ padding: "3rem 0" }}>
      <h1>Product not found</h1>
      <p>This product may be unpublished.</p>
      <Link className={styles.returnLink} href="/">Shop</Link>
    </main>
  );
}

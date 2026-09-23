import Link from "next/link";
import { CartLink } from "../cart/cart-link";

export function StoreHeader() {
  return (
    <header className="store-header">
      <Link className="wordmark" href="/" aria-label="برافوس">
        <img src="/brand/02_Logo_Horizontal_Black.svg" alt="" width={168} height={71} />
      </Link>
      <nav className="store-nav" aria-label="التنقل الرئيسي">
        <Link href="/">المتجر</Link>
        <CartLink />
      </nav>
    </header>
  );
}

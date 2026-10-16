"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { CartLink } from "../cart/cart-link";

export function StoreHeader() {
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const home = pathname === "/";

  useEffect(() => {
    const header = headerRef.current;
    const sentinel = sentinelRef.current;
    if (!header || !sentinel || typeof IntersectionObserver === "undefined") return;
    const apply = (scrolled: boolean) => {
      header.dataset.scrolled = scrolled ? "true" : "false";
    };
    apply(window.scrollY > 8);
    const observer = new IntersectionObserver(([entry]) => {
      apply(!entry?.isIntersecting);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <>
      <div ref={sentinelRef} className="header-sentinel" aria-hidden="true" />
      <header
        ref={headerRef}
        className="store-header"
        data-route={pathname === "/cart" ? "bag" : undefined}
      >
        <Link className="wordmark" href="/" aria-label="Bravos">
          <img src="/brand/02_Logo_Horizontal_Ivory.svg" alt="" width={168} height={71} />
        </Link>
        <nav className="store-nav" aria-label="Primary">
          <Link href="/" aria-current={home ? "page" : undefined}>Shop</Link>
          <Link className="nav-all" href="/#catalog-title" prefetch={false}>Categories</Link>
          <CartLink />
        </nav>
      </header>
    </>
  );
}

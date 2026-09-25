"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PublicProductDto } from "@bravos/contracts/public";
import { useCart } from "./cart-provider";
import { CartLine } from "./cart-line";
import { CartSummary } from "./cart-summary";
import styles from "./cart.module.css";

export default function CartPage() {
  const cart = useCart();
  const validated = useRef(false);
  const [checking, setChecking] = useState(false);
  const [availabilityMessage, setAvailabilityMessage] = useState("");
  const total = cart.items.reduce((sum, item) => sum + item.unitPricePiasters * item.quantity, 0);

  useEffect(() => {
    if (!cart.hydrated || validated.current) return;
    validated.current = true;
    void revalidateCart();
  }, [cart.hydrated]);

  async function revalidateCart() {
    const before = cart.items;
    if (before.length === 0) return;
    setChecking(true);
    setAvailabilityMessage("");
    try {
      const productIds = [...new Set(before.map((item) => item.productId))];
      const products = await Promise.all(productIds.map(async (productId) => {
        const response = await fetch(`/api/public/catalog/products/${encodeURIComponent(productId)}`, { cache: "no-store" });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("availability");
        return response.json() as Promise<PublicProductDto>;
      }));
      const byId = new Map(products.filter((product): product is PublicProductDto => Boolean(product)).map((product) => [product.id, product]));
      let changed = false;
      for (const item of before) {
        const product = byId.get(item.productId);
        const variant = product?.variants.find((candidate) => candidate.id === item.variantId);
        const next = variant && product ? {
          productId: product.id,
          productNameAr: product.nameAr,
          sizeNameAr: variant.size.nameAr,
          colorNameAr: variant.color.nameAr,
          unitPricePiasters: variant.sellingPricePiasters,
          imageRef: product.imageRefs[0] ?? null,
          knownAvailableQuantity: variant.availableQuantity,
          orderable: variant.orderable,
        } : {
          knownAvailableQuantity: 0,
          orderable: false,
        };
        if (
          next.knownAvailableQuantity !== item.knownAvailableQuantity
          || next.orderable !== item.orderable
          || ("unitPricePiasters" in next && next.unitPricePiasters !== item.unitPricePiasters)
        ) changed = true;
        await cart.refreshLine(item.variantId, next);
      }
      setAvailabilityMessage(changed ? "تغيّرت بعض بيانات السلة حسب المخزون الحالي. راجع التنبيهات قبل المتابعة." : "السلة مطابقة للمخزون الحالي.");
    } catch {
      setAvailabilityMessage("تعذر التحقق من المخزون الآن. أعد المحاولة قبل متابعة الطلب.");
    } finally {
      setChecking(false);
    }
  }

  if (!cart.hydrated) {
    return <main id="main-content" className={`cart-page ${styles.page}`}><p className={styles.hydrating} role="status">لحظات...</p></main>;
  }

  return (
    <main id="main-content" className={`cart-page ${styles.page}`}>
      <div className={`page-title ${styles.heading}`}>
        <p className="eyebrow">اختياراتك</p>
        <h1>سلة التسوق</h1>
        <p>{cart.storageStatus === "ready"
          ? "السلة تحفظ اختياراتك في هذا المتصفح لتراجع المقاسات والألوان والكميات."
          : "يمكنك استخدام السلة الآن، لكن اختياراتك الحالية محفوظة مؤقتاً في هذه الصفحة فقط."}</p>
      </div>
      {cart.storageStatus === "unavailable" ? (
        <p className={styles.storageWarning} role="alert">يتعذر حفظ السلة في هذا المتصفح الآن. ستفقد اختياراتك عند إغلاق الصفحة أو إعادة تحميلها.</p>
      ) : null}
      {cart.storageStatus === "corrupt" ? (
        <p className={styles.storageWarning} role="alert">تعذر قراءة السلة المحفوظة. تركنا البيانات الأصلية دون تغيير، وتعمل السلة الحالية مؤقتاً فقط.</p>
      ) : null}
      {availabilityMessage ? <p className={`cart-status ${styles.status} ${availabilityMessage.startsWith("تعذر") ? styles.errorStatus : ""}`} role="status">{availabilityMessage}</p> : null}
      {cart.items.length === 0 ? (
        <div className={`empty-state ${styles.empty}`}>
          <h2>السلة فارغة</h2>
          <p>اختر منتجاً ومقاساً ولوناً لإضافته هنا. إضافة المنتجات إلى السلة لا تحجز المخزون.</p>
          <Link className="button-link" href="/">تصفّح المنتجات</Link>
        </div>
      ) : (
        <div className={styles.layout}>
          <section className={styles.lines} aria-label="منتجات السلة">
            {cart.items.map((item) => (
              <CartLine
                key={item.variantId}
                item={item}
                onQuantityChange={(variantId, quantity, maximum) => void cart.setQuantity(variantId, quantity, maximum)}
                onRemove={(variantId) => void cart.remove(variantId)}
              />
            ))}
          </section>
          <CartSummary
            itemCount={cart.itemCount}
            merchandiseTotal={total}
            checking={checking}
            canCheckout={cart.items.every((item) => item.orderable && item.quantity <= item.knownAvailableQuantity)}
            onRefresh={() => void revalidateCart()}
          />
        </div>
      )}
    </main>
  );
}

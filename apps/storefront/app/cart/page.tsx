"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PublicProductDto } from "@bravos/contracts/public";
import { useCart } from "./cart-provider";
import { formatEgp, productMediaUrl } from "../public-catalog";

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
    return <main id="main-content" className="cart-page"><p>جارٍ تحميل السلة…</p></main>;
  }

  return (
    <main id="main-content" className="cart-page">
      <div className="page-title">
        <p className="eyebrow">اختياراتك</p>
        <h1>سلة التسوق</h1>
        <p>{cart.storageStatus === "ready"
          ? "السلة تحفظ اختياراتك في هذا المتصفح لتراجع المقاسات والألوان والكميات."
          : "يمكنك استخدام السلة الآن، لكن اختياراتك الحالية محفوظة مؤقتاً في هذه الصفحة فقط."}</p>
      </div>
      {cart.storageStatus === "unavailable" ? (
        <p className="stock-warning" role="alert">يتعذر حفظ السلة في هذا المتصفح الآن. ستفقد اختياراتك عند إغلاق الصفحة أو إعادة تحميلها.</p>
      ) : null}
      {cart.storageStatus === "corrupt" ? (
        <p className="stock-warning" role="alert">تعذر قراءة السلة المحفوظة. تركنا البيانات الأصلية دون تغيير، وتعمل السلة الحالية مؤقتاً فقط.</p>
      ) : null}
      {cart.items.length === 0 ? (
        <div className="empty-state">
          <h2>السلة فارغة</h2>
          <p>اختر منتجاً ومقاساً ولوناً لإضافته هنا.</p>
          <Link className="button-link" href="/">تصفّح المنتجات</Link>
        </div>
      ) : (
        <div className="cart-layout">
          <section className="cart-lines" aria-label="منتجات السلة">
            {cart.items.map((item) => {
              const unavailable = !item.orderable || item.knownAvailableQuantity === 0;
              const excessive = item.quantity > item.knownAvailableQuantity;
              return (
                <article className="cart-line" key={item.variantId}>
                  <div className="cart-photo">
                    {item.imageRef ? <Image src={productMediaUrl(item.imageRef)} alt="" fill unoptimized sizes="112px" /> : <span>صورة المنتج</span>}
                  </div>
                  <div className="cart-line-copy">
                    <Link href={`/products/${item.productId}`}><h2>{item.productNameAr}</h2></Link>
                    <p>المقاس: {item.sizeNameAr} · اللون: {item.colorNameAr}</p>
                    <strong>{formatEgp(item.unitPricePiasters)}</strong>
                    {unavailable ? <p className="stock-warning" role="alert">هذا الاختيار غير متوفر حالياً. احذفه أو انتظر عودة المخزون.</p> : null}
                    {excessive && item.knownAvailableQuantity > 0 ? (
                      <p className="stock-warning" role="alert">المتاح الآن {item.knownAvailableQuantity} فقط.</p>
                    ) : null}
                  </div>
                  <div className="quantity-control" aria-label={`كمية ${item.productNameAr} ${item.sizeNameAr} ${item.colorNameAr}`}>
                    <button
                      type="button"
                      aria-label="تقليل الكمية"
                      disabled={item.quantity <= 1 || unavailable || excessive}
                      onClick={() => void cart.setQuantity(item.variantId, item.quantity - 1, item.knownAvailableQuantity)}
                    >−</button>
                    <output aria-live="polite">{item.quantity}</output>
                    <button
                      type="button"
                      aria-label="زيادة الكمية"
                      disabled={unavailable || excessive || item.quantity >= item.knownAvailableQuantity}
                      onClick={() => void cart.setQuantity(item.variantId, item.quantity + 1, item.knownAvailableQuantity)}
                    >+</button>
                    {excessive && item.knownAvailableQuantity > 0 ? (
                      <button className="fit-stock" type="button" onClick={() => void cart.setQuantity(item.variantId, item.knownAvailableQuantity, item.knownAvailableQuantity)}>ضبط للمتاح</button>
                    ) : null}
                    <button className="remove-line" type="button" onClick={() => void cart.remove(item.variantId)}>حذف</button>
                  </div>
                </article>
              );
            })}
          </section>
          <aside className="cart-summary" aria-label="ملخص السلة">
            <h2>الملخص</h2>
            <p><span>عدد القطع</span><strong>{cart.itemCount}</strong></p>
            <p><span>إجمالي المنتجات</span><strong>{formatEgp(total)}</strong></p>
            <button type="button" className="secondary-action" disabled={checking} onClick={() => void revalidateCart()}>
              {checking ? "جارٍ التحقق…" : "تحديث المخزون"}
            </button>
            {cart.items.every((item) => item.orderable && item.quantity <= item.knownAvailableQuantity) ? (
              <Link className="button-link cart-checkout-link" href="/checkout">متابعة إتمام الطلب</Link>
            ) : (
              <p className="stock-warning">عدّل الاختيارات غير المتوفرة قبل إتمام الطلب.</p>
            )}
            <p className="muted">لا يتم حجز أي قطعة داخل السلة.</p>
          </aside>
        </div>
      )}
      {availabilityMessage ? <p className="cart-status" role="status">{availabilityMessage}</p> : null}
    </main>
  );
}

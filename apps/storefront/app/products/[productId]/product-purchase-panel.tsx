"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PublicProductVariantDto } from "@bravos/contracts/public";
import { useCart } from "../../cart/cart-provider";
import { formatEgp } from "../../public-catalog";
import styles from "./product-page.module.css";

export type PurchaseProduct = {
  id: string;
  nameAr: string;
  orderable: boolean;
  imageRef: string | null;
  variants: PublicProductVariantDto[];
};

type ProductPurchasePanelProps = {
  product: PurchaseProduct;
  gallery: ReactNode;
  introduction: ReactNode;
  sizeGuide: ReactNode;
};

export function ProductPurchasePanel({ product, gallery, introduction, sizeGuide }: ProductPurchasePanelProps) {
  const cart = useCart();
  const copyRef = useRef<HTMLElement>(null);
  const addingRef = useRef(false);
  const [canStick, setCanStick] = useState(false);
  const initialVariant = product.variants.find((variant) => variant.orderable)?.id ?? "";
  const [variantId, setVariantId] = useState(initialVariant);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const [addedSuccessfully, setAddedSuccessfully] = useState(false);
  const [adding, setAdding] = useState(false);
  const selected = product.variants.find((variant) => variant.id === variantId) ?? null;
  const alreadyInCart = useMemo(
    () => cart.items.find((item) => item.variantId === variantId)?.quantity ?? 0,
    [cart.items, variantId],
  );
  const remaining = Math.max(0, (selected?.availableQuantity ?? 0) - alreadyInCart);
  const addDisabled = !product.orderable || !selected || remaining === 0 || !Number.isInteger(quantity) || quantity < 1 || quantity > remaining || adding;
  const addLabel = remaining === 0 && selected ? "الكمية المتاحة في السلة" : "أضف إلى السلة";

  useEffect(() => {
    const copy = copyRef.current;
    if (!copy) return;
    function measure() {
      const viewportHeight = Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight);
      setCanStick(copy!.getBoundingClientRect().height <= viewportHeight - 32);
    }
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(copy);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    measure();
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);

  async function addToCart() {
    if (addingRef.current) return;
    if (!selected) {
      setAddedSuccessfully(false);
      setMessage("اختر المقاس واللون أولاً.");
      return;
    }
    addingRef.current = true;
    setAdding(true);
    try {
      const added = await cart.add({
        productId: product.id,
        variantId: selected.id,
        productNameAr: product.nameAr,
        sizeNameAr: selected.size.nameAr,
        colorNameAr: selected.color.nameAr,
        unitPricePiasters: selected.sellingPricePiasters,
        imageRef: product.imageRef,
        knownAvailableQuantity: selected.availableQuantity,
        orderable: selected.orderable,
        quantity,
      });
      setAddedSuccessfully(added);
      setMessage(added ? "تمت إضافة الاختيار إلى السلة." : "لا يمكن إضافة هذه الكمية حسب المخزون الحالي. راجع الاختيار والكمية.");
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }

  return (
    <>
      {gallery}
      <section ref={copyRef} className={styles.copy} data-sticky={canStick ? "true" : undefined}>
        {introduction}
        <section className={`purchase-panel ${styles.purchasePanel}`} aria-labelledby="choose-variant">
          <div className={styles.selectionHeading}>
            <h2 id="choose-variant">اختر المقاس واللون</h2>
            {selected ? (
              <p className={styles.selectedPrice}>
                <span>سعر الاختيار</span>
                <strong>{formatEgp(selected.sellingPricePiasters)}</strong>
              </p>
            ) : (
              <p className={styles.pricePrompt}>اختر المقاس واللون لمعرفة السعر.</p>
            )}
          </div>
          <fieldset className={`variant-picker ${styles.variantPicker}`} disabled={!product.orderable}>
            <legend className="sr-only">تركيبات المقاس واللون</legend>
            {product.variants.map((variant) => (
              <label className={`variant-option ${styles.variantOption}`} key={variant.id}>
                <input
                  type="radio"
                  name="variant"
                  value={variant.id}
                  checked={variantId === variant.id}
                  disabled={!variant.orderable}
                  onChange={() => {
                    setVariantId(variant.id);
                    setQuantity(1);
                    setMessage("");
                    setAddedSuccessfully(false);
                  }}
                />
                <span><b>{variant.size.nameAr}</b><small>{variant.color.nameAr}</small></span>
                <strong>{formatEgp(variant.sellingPricePiasters)}</strong>
                {!variant.orderable ? <em>غير متوفر</em> : null}
              </label>
            ))}
          </fieldset>
          {product.orderable ? (
            <div className={styles.addRow}>
              <label htmlFor="product-quantity">الكمية</label>
              <input
                id="product-quantity"
                type="number"
                inputMode="numeric"
                min={1}
                max={remaining}
                step={1}
                value={quantity}
                disabled={!selected || remaining === 0}
                onChange={(event) => {
                  setQuantity(Number(event.target.value));
                  setMessage("");
                  setAddedSuccessfully(false);
                }}
              />
              <button className={styles.inlineAction} type="button" disabled={addDisabled} aria-busy={adding} onClick={() => void addToCart()}>
                {addLabel}
              </button>
            </div>
          ) : null}
          {message ? (
            <p className={addedSuccessfully ? styles.successFeedback : styles.failureFeedback} role="status">
              {message} {addedSuccessfully ? <Link href="/cart">عرض السلة</Link> : null}
            </p>
          ) : null}
        </section>
        {sizeGuide}
      </section>
      {product.orderable ? (
        <div className={styles.mobileBar} aria-label="إضافة المنتج إلى السلة">
          <div className={styles.mobileSelection}>
            <strong>{selected ? formatEgp(selected.sellingPricePiasters) : "اختر المقاس واللون"}</strong>
            <span>{selected ? `${selected.size.nameAr} / ${selected.color.nameAr} · ${quantity}` : "لم يتم اختيار مقاس ولون"}</span>
            <a href="#choose-variant">تغيير الاختيار</a>
          </div>
          <button type="button" disabled={addDisabled} aria-busy={adding} onClick={() => void addToCart()}>{addLabel}</button>
          {addedSuccessfully ? <Link className={styles.mobileCartLink} href="/cart">تمت الإضافة · عرض السلة</Link> : null}
          {message && !addedSuccessfully ? (
            <a className={styles.mobileFailure} href="#choose-variant">تعذر الإضافة · راجع الاختيار والكمية</a>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

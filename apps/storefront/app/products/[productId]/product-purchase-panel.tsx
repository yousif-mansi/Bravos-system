"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PublicProductVariantDto } from "@bravos/contracts/public";
import { useCart } from "../../cart/cart-provider";
import { formatEgp } from "../../public-catalog";
import styles from "./product-page.module.css";
import { colorChoices, firstOrderableVariantId, sizesForColor, variantIdForColor } from "./variant-selection";

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
  const initialVariant = firstOrderableVariantId(product.variants);
  const [variantId, setVariantId] = useState(initialVariant);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const [addedSuccessfully, setAddedSuccessfully] = useState(false);
  const [adding, setAdding] = useState(false);
  const selected = product.variants.find((variant) => variant.id === variantId) ?? null;
  const colors = colorChoices(product.variants);
  const sizes = selected ? sizesForColor(product.variants, selected.color.id) : [];
  const alreadyInCart = useMemo(
    () => cart.items.reduce((sum, item) => sum + (item.productId === product.id ? item.quantity : 0), 0),
    [cart.items, product.id],
  );
  const remaining = Math.max(0, (selected?.availableQuantity ?? 0) - alreadyInCart);
  const addDisabled = !product.orderable || !selected || remaining === 0 || !Number.isInteger(quantity) || quantity < 1 || quantity > remaining || adding;
  const addLabel = adding ? "Adding…" : remaining === 0 && selected ? "Available quantity is in your bag" : "Add to bag";
  const quantityGuidance = !selected || remaining === 0
    ? ""
    : !Number.isInteger(quantity) || quantity < 1
      ? "Enter a whole number from 1."
      : quantity > remaining
        ? `Reduce the quantity to ${remaining}.`
        : "";

  useEffect(() => {
    const copy = copyRef.current;
    if (!copy) return;
    function readStickyTop() {
      const node = copy!;
      const inlinePosition = node.style.position;
      if (getComputedStyle(node).position === "static") node.style.position = "relative";
      const offset = Number.parseFloat(getComputedStyle(node).top);
      node.style.position = inlinePosition;
      return offset;
    }
    function measure() {
      const viewportHeight = Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight);
      const stickyTop = readStickyTop();
      const breathingRoom = 24;
      setCanStick(Number.isFinite(stickyTop) && copy!.getBoundingClientRect().height <= viewportHeight - stickyTop - breathingRoom);
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
      setMessage("Choose a size and color first.");
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
      setMessage(added ? "Added to your bag." : "This quantity can't be added with the current stock. Review the selection and quantity.");
    } catch {
      setAddedSuccessfully(false);
      setMessage("This selection couldn't be added to your bag. Try again.");
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }

  function acceptVariant(nextId: string) {
    if (!nextId || nextId === variantId) return;
    setVariantId(nextId);
    setQuantity(1);
    setMessage("");
    setAddedSuccessfully(false);
  }

  return (
    <>
      {gallery}
      <section ref={copyRef} className={styles.copy} data-sticky={canStick ? "true" : undefined}>
        {introduction}
        <section className={`purchase-panel ${styles.purchasePanel}`} aria-labelledby="choose-variant">
          <div className={styles.selectionHeading}>
            <h2 id="choose-variant">Choose size and color</h2>
            {selected ? (
              <p className={styles.selectedPrice}>
                <span>Selected price</span>
                <strong>{formatEgp(selected.sellingPricePiasters)}</strong>
              </p>
            ) : (
              <p className={styles.pricePrompt}>
                {product.variants.length > 0
                  ? "Size and color share one price and one available quantity. None can be ordered."
                  : "No size and color can be ordered."}
              </p>
            )}
          </div>
          {selected ? (
            <>
              <p className={styles.selectionHint}>Choose a color, then a size. Every option uses the same available quantity.</p>
              <fieldset className={styles.choiceGroup} disabled={!product.orderable}>
                <legend className={styles.choiceLegend}>Color</legend>
                <div className={styles.choiceList}>
                  {colors.map((color) => (
                    <label className={`color-option ${styles.choiceOption}`} key={color.id}>
                      <input
                        type="radio"
                        name="purchase-color"
                        value={color.id}
                        checked={selected.color.id === color.id}
                        disabled={!color.orderable}
                        onChange={() => {
                          const nextId = variantIdForColor(product.variants, color.id, selected.size.id);
                          if (nextId) acceptVariant(nextId);
                        }}
                      />
                      <span dir="auto">{color.nameAr}</span>
                      {!color.orderable ? <em>Unavailable</em> : null}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className={styles.choiceGroup} disabled={!product.orderable}>
                <legend className={styles.choiceLegend}>Size</legend>
                {sizes.length > 0 ? (
                  <div className={styles.choiceList}>
                    {sizes.map((size) => (
                      <label className={`size-option ${styles.choiceOption}`} key={size.variantId}>
                        <input
                          type="radio"
                          name="purchase-size"
                          value={size.variantId}
                          checked={selected.id === size.variantId}
                          disabled={!size.orderable}
                          onChange={() => {
                            if (size.orderable) acceptVariant(size.variantId);
                          }}
                        />
                        <span dir="auto">{size.nameAr}</span>
                        <small>{formatEgp(size.sellingPricePiasters)}</small>
                        {!size.orderable ? <em>Unavailable</em> : null}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className={styles.choiceEmpty}>No size is selected.</p>
                )}
              </fieldset>
            </>
          ) : (
            <>
              <p className={styles.selectionHint}>These size and color pairs cannot be ordered.</p>
              {product.variants.length > 0 ? (
                <ul className={styles.unavailablePairs} aria-label="Unavailable size and color pairs">
                  {product.variants.map((variant) => (
                    <li className={styles.unavailablePair} key={variant.id}>
                      <span>Size <b dir="auto">{variant.size.nameAr}</b></span>
                      <span>Color <b dir="auto">{variant.color.nameAr}</b></span>
                      <strong>{formatEgp(variant.sellingPricePiasters)}</strong>
                      <em>Unavailable</em>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
          {product.orderable ? (
            <div className={styles.addRow}>
              <label htmlFor="product-quantity">Quantity</label>
              <input
                id="product-quantity"
                type="number"
                inputMode="numeric"
                min={1}
                max={remaining}
                step={1}
                aria-describedby={quantityGuidance ? "product-availability product-quantity-guidance" : "product-availability"}
                aria-invalid={quantityGuidance ? true : undefined}
                value={quantity}
                disabled={!selected || remaining === 0}
                onChange={(event) => {
                  setQuantity(Number(event.target.value));
                  setMessage("");
                  setAddedSuccessfully(false);
                }}
              />
              <button className={styles.inlineAction} type="button" disabled={addDisabled} aria-busy={adding} aria-describedby={quantityGuidance ? "product-quantity-guidance" : undefined} onClick={() => void addToCart()}>
                {addLabel}
              </button>
              {quantityGuidance ? <p id="product-quantity-guidance" className={styles.quantityGuidance}>{quantityGuidance}</p> : null}
            </div>
          ) : null}
          {product.orderable ? (
            <p id="product-availability" className={styles.stockNote}>
              {selected ? remaining > 0 ? `You can add up to ${remaining} of this selection.` : "You added the available quantity of this selection to your bag." : "Choose a size and color first."}
              {alreadyInCart > 0 ? <span> In your bag: {alreadyInCart}.</span> : null}
            </p>
          ) : null}
          <p className={message ? addedSuccessfully ? styles.successFeedback : styles.failureFeedback : styles.emptyFeedback} role="status" aria-live="polite" aria-atomic="true">
            {message} {addedSuccessfully ? <Link href="/cart">View bag</Link> : null}
          </p>
          {product.orderable ? <p className={styles.purchaseNote}>Adding to your bag does not reserve the item. Availability is checked when you submit the order.</p> : null}
        </section>
      </section>
      {sizeGuide ? <section className={styles.chapters} aria-label="Product information">{sizeGuide}</section> : null}
      {product.orderable ? (
        <div className={styles.mobileBar} aria-label="Add product to bag">
          <div className={styles.mobileSelection}>
            <strong>{selected ? formatEgp(selected.sellingPricePiasters) : "Choose size and color"}</strong>
            {selected ? (
              <span className={styles.mobileVariant}>
                <span>Size <b dir="auto">{selected.size.nameAr}</b></span>
                <span>Color <b dir="auto">{selected.color.nameAr}</b></span>
                {quantityGuidance ? null : <span>Qty {quantity}</span>}
              </span>
            ) : (
              <span>No size and color selected</span>
            )}
            <a href="#choose-variant">Change selection</a>
          </div>
          <div className={styles.mobileAction}>
            <button className={quantityGuidance ? styles.mobileSuppressedAction : undefined} type="button" disabled={addDisabled} aria-busy={adding} onClick={() => void addToCart()}>{addLabel}</button>
            {quantityGuidance ? <a className={styles.mobileQuantityRepair} href="#product-quantity">{quantityGuidance}</a> : null}
          </div>
          {addedSuccessfully ? <Link className={styles.mobileCartLink} href="/cart">Added · View bag</Link> : null}
          {message && !addedSuccessfully ? (
            <a className={styles.mobileFailure} href="#choose-variant">Couldn't add · Check the selection and quantity</a>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

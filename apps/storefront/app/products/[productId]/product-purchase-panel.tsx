"use client";

import { useMemo, useState } from "react";
import type { PublicProductVariantDto } from "@bravos/contracts/public";
import { useCart } from "../../cart/cart-provider";
import { formatEgp } from "../../public-catalog";

export type PurchaseProduct = {
  id: string;
  nameAr: string;
  orderable: boolean;
  imageRef: string | null;
  variants: PublicProductVariantDto[];
};

export function ProductPurchasePanel({ product }: { product: PurchaseProduct }) {
  const cart = useCart();
  const initialVariant = product.variants.find((variant) => variant.orderable)?.id ?? "";
  const [variantId, setVariantId] = useState(initialVariant);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const selected = product.variants.find((variant) => variant.id === variantId) ?? null;
  const alreadyInCart = useMemo(
    () => cart.items.find((item) => item.variantId === variantId)?.quantity ?? 0,
    [cart.items, variantId],
  );
  const remaining = Math.max(0, (selected?.availableQuantity ?? 0) - alreadyInCart);

  function addToCart() {
    if (!selected) {
      setMessage("اختر المقاس واللون أولاً.");
      return;
    }
    const added = cart.add({
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
    setMessage(added ? "تمت إضافة الاختيار إلى السلة." : "لا يمكن إضافة هذه الكمية حسب المخزون الحالي.");
  }

  return (
    <section className="purchase-panel" aria-labelledby="choose-variant">
      <h2 id="choose-variant">اختر المقاس واللون</h2>
      <fieldset className="variant-picker" disabled={!product.orderable}>
        <legend className="sr-only">تركيبات المقاس واللون</legend>
        {product.variants.map((variant) => (
          <label className="variant-option" key={variant.id}>
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
              }}
            />
            <span><b>{variant.size.nameAr}</b><small>{variant.color.nameAr}</small></span>
            <strong>{formatEgp(variant.sellingPricePiasters)}</strong>
            {!variant.orderable ? <em>غير متوفر</em> : null}
          </label>
        ))}
      </fieldset>
      {product.orderable ? (
        <div className="add-row">
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
            onChange={(event) => setQuantity(Number(event.target.value))}
          />
          <button type="button" disabled={!selected || remaining === 0 || !Number.isInteger(quantity) || quantity < 1 || quantity > remaining} onClick={addToCart}>
            {remaining === 0 && selected ? "الكمية المتاحة في السلة" : "أضف إلى السلة"}
          </button>
        </div>
      ) : null}
      {message ? <p className={message.startsWith("تمت") ? "success" : "notice-text"} role="status">{message}</p> : null}
    </section>
  );
}

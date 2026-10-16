import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { CartLine as CartItem } from "./cart-types";
import { formatEgp, productMediaUrl } from "../public-catalog";
import styles from "./cart.module.css";

type CartLineProps = {
  item: CartItem;
  onQuantityChange: (variantId: string, quantity: number, maximum: number) => void;
  onRemove: (variantId: string) => void;
};

export function CartLine({ item, onQuantityChange, onRemove }: CartLineProps) {
  const [failedImageRef, setFailedImageRef] = useState<string | null>(null);
  const unavailable = !item.orderable || item.knownAvailableQuantity === 0;
  const excessive = item.quantity > item.knownAvailableQuantity;

  return (
    <article className={`cart-line ${styles.line}`}>
      <div className={styles.photo}>
        {item.imageRef && item.imageRef !== failedImageRef ? (
          <Image src={productMediaUrl(item.imageRef)} alt="" fill unoptimized sizes="(max-width: 580px) 88px, 112px" onError={() => setFailedImageRef(item.imageRef)} />
        ) : <span>{item.imageRef ? "This photo is unavailable right now" : "Product photo"}</span>}
      </div>
      <div className={styles.details}>
        <Link className={styles.productLink} href={`/products/${item.productId}`} prefetch={false}><h2 dir="auto">{item.productNameAr}</h2></Link>
        <p className={styles.variant}>Size: <span dir="auto">{item.sizeNameAr}</span> <span aria-hidden="true">·</span> Color: <span dir="auto">{item.colorNameAr}</span></p>
        <p className={styles.unitPrice}>Unit price <strong>{formatEgp(item.unitPricePiasters)}</strong></p>
        {unavailable ? <p className={`stock-warning ${styles.stockWarning}`} role="alert">This selection is unavailable right now. Remove it or wait for stock to return.</p> : null}
        {excessive && item.knownAvailableQuantity > 0 ? (
          <p className={`stock-warning ${styles.stockWarning}`} role="alert">Only {item.knownAvailableQuantity} available now.</p>
        ) : null}
      </div>
      <div className={styles.actions}>
        <div className={styles.quantity} role="group" aria-label={`Quantity of ${item.productNameAr}, ${item.sizeNameAr}, ${item.colorNameAr}`}>
          <button
            className="remove-line"
            type="button"
            aria-label="Decrease quantity"
            disabled={item.quantity <= 1 || unavailable || excessive}
            onClick={() => onQuantityChange(item.variantId, item.quantity - 1, item.knownAvailableQuantity)}
          >−</button>
          <output aria-live="polite">{item.quantity}</output>
          <button
            className="remove-line"
            type="button"
            aria-label="Increase quantity"
            disabled={unavailable || excessive || item.quantity >= item.knownAvailableQuantity}
            onClick={() => onQuantityChange(item.variantId, item.quantity + 1, item.knownAvailableQuantity)}
          >+</button>
        </div>
        {excessive && item.knownAvailableQuantity > 0 ? (
          <button className={`fit-stock ${styles.fitStock}`} type="button" onClick={() => onQuantityChange(item.variantId, item.knownAvailableQuantity, item.knownAvailableQuantity)}>Fit to available</button>
        ) : null}
        <button className={`remove-line ${styles.remove}`} type="button" onClick={() => onRemove(item.variantId)}>Remove</button>
      </div>
      <p className={styles.lineTotal}><span>Selection total</span><strong>{formatEgp(item.unitPricePiasters * item.quantity)}</strong></p>
    </article>
  );
}

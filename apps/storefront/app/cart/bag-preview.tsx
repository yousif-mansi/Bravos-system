"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { formatEgp, productMediaUrl } from "../public-catalog";
import type { CartLine } from "./cart-types";
import { useCart } from "./cart-provider";
import styles from "./bag-preview.module.css";

type ScrollLock = {
  overflow: string;
  x: number;
  y: number;
  path: string;
};

function here(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

const TABBABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function visibleTabbables(dialog: HTMLDialogElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)].filter((element) => {
    if (element.tabIndex < 0 || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return false;
    if (element.closest("[hidden]")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  });
}

function keepTabInDialog(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
  const dialog = event.currentTarget;
  if (!dialog.open) return;
  const controls = visibleTabbables(dialog);
  if (controls.length === 0) return;
  const active = document.activeElement;
  const inside = active instanceof Node && dialog.contains(active);
  const current = active instanceof HTMLElement ? controls.indexOf(active) : -1;
  const lost = !inside || active === dialog || current < 0;
  const leaveForward = !event.shiftKey && current === controls.length - 1;
  const leaveBackward = event.shiftKey && current === 0;
  if (!lost && !leaveForward && !leaveBackward) return;
  event.preventDefault();
  const next = event.shiftKey ? controls[controls.length - 1] : controls[0];
  next.focus({ preventScroll: true });
}

export function BagPreview() {
  const { items, itemCount, hydrated, storageStatus } = useCart();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollLock = useRef<ScrollLock | null>(null);
  const restoreFocus = useRef(true);
  const mounted = useRef(false);
  const seenPath = useRef<string | null>(null);
  const titleId = useId();
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(() => new Set());
  const merchandisePiasters = items.reduce((sum, item) => sum + item.unitPricePiasters * item.quantity, 0);

  function lockScroll(): ScrollLock {
    if (scrollLock.current) return scrollLock.current;
    const saved = {
      overflow: document.body.style.overflow,
      x: window.scrollX,
      y: window.scrollY,
      path: here(),
    };
    scrollLock.current = saved;
    document.body.style.overflow = "hidden";
    return saved;
  }

  function unlockScroll() {
    const saved = scrollLock.current;
    if (!saved) return;
    scrollLock.current = null;
    document.body.style.overflow = saved.overflow;
    // Same route only. A bag link should navigate without replaying this scroll position.
    if (here() === saved.path) window.scrollTo({ left: saved.x, top: saved.y, behavior: "instant" });
  }

  function handleClose() {
    if (mounted.current) setOpen(false);
    unlockScroll();
    if (restoreFocus.current && mounted.current) triggerRef.current?.focus({ preventScroll: true });
    restoreFocus.current = true;
  }

  function openPreview() {
    const dialog = dialogRef.current;
    if (!hydrated || !dialog || dialog.open) return;
    const saved = lockScroll();
    try {
      dialog.showModal();
    } catch {
      unlockScroll();
      return;
    }
    setOpen(true);
    closeRef.current?.focus({ preventScroll: true });
    window.scrollTo({ left: saved.x, top: saved.y, behavior: "instant" });
  }

  function closePreview(shouldRestoreFocus = true) {
    restoreFocus.current = shouldRestoreFocus;
    dialogRef.current?.close();
  }

  useEffect(() => {
    mounted.current = true;
    setPortalReady(true);
    return () => {
      mounted.current = false;
      restoreFocus.current = false;
      const saved = scrollLock.current;
      scrollLock.current = null;
      if (saved) document.body.style.overflow = saved.overflow;
      if (dialogRef.current?.open) dialogRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (seenPath.current === null) {
      seenPath.current = pathname;
      return;
    }
    if (seenPath.current === pathname) return;
    seenPath.current = pathname;
    if (!dialogRef.current?.open) return;
    restoreFocus.current = false;
    dialogRef.current.close();
  }, [pathname]);

  function onDialogClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) closePreview(true);
  }

  const dialog = (
    <dialog
      ref={dialogRef}
      id={dialogId}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClick={onDialogClick}
      onClose={handleClose}
      onKeyDown={keepTabInDialog}
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <h2 id={titleId}>Your bag</h2>
            <p>{itemCount === 1 ? "1 item" : `${itemCount} items`}</p>
          </div>
          <button ref={closeRef} type="button" className={styles.close} aria-label="Close bag preview" onClick={() => closePreview(true)}>
            <CloseIcon />
          </button>
        </header>
        {storageStatus === "unavailable" ? (
          <p className={styles.storage} role="alert">This browser can't save the bag right now. These selections will be lost if you close or reload the page.</p>
        ) : null}
        {storageStatus === "corrupt" ? (
          <p className={styles.storage} role="alert">The saved bag couldn't be read. The original data was left unchanged, and this bag works only for now.</p>
        ) : null}
        <div className={styles.scroller}>
          {items.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyMark} aria-hidden="true">BRAVOS</p>
              <p className={styles.emptyTitle}>Your bag is empty</p>
              <p>Choose a product, then a size and color. Adding a product does not reserve it.</p>
              <Link className={styles.browse} href="/#catalog-title" onClick={() => closePreview(false)}>Browse products</Link>
            </div>
          ) : (
            <ul className={styles.lines} aria-label="Bag items">
              {items.map((item) => (
                <BagPreviewLine
                  key={item.variantId}
                  item={item}
                  failed={failedImages.has(`${item.variantId}:${item.imageRef ?? ""}`)}
                  onImageError={() => {
                    const key = `${item.variantId}:${item.imageRef ?? ""}`;
                    setFailedImages((current) => {
                      if (current.has(key)) return current;
                      const next = new Set(current);
                      next.add(key);
                      return next;
                    });
                  }}
                  onFollow={() => closePreview(false)}
                />
              ))}
            </ul>
          )}
        </div>
        {items.length > 0 ? (
          <footer className={styles.footer}>
            <dl className={styles.totals}>
              <div>
                <dt>Estimated merchandise</dt>
                <dd>{formatEgp(merchandisePiasters)}</dd>
              </div>
            </dl>
            <p className={styles.estimateNote}>Saved item prices, before discounts and delivery. Review your total at checkout. Items are not reserved.</p>
            <Link className={styles.review} href="/cart" onClick={() => closePreview(false)}>Review bag & checkout</Link>
          </footer>
        ) : null}
      </div>
    </dialog>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label="Preview bag"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={portalReady ? dialogId : undefined}
        disabled={!hydrated || !portalReady}
        onClick={openPreview}
      >
        <BagIcon />
      </button>
      {portalReady ? createPortal(dialog, document.body) : null}
    </>
  );
}

function BagPreviewLine({ item, failed, onImageError, onFollow }: {
  item: CartLine;
  failed: boolean;
  onImageError: () => void;
  onFollow: () => void;
}) {
  const unavailable = !item.orderable || item.knownAvailableQuantity === 0;
  const excessive = item.quantity > item.knownAvailableQuantity;
  const showPhoto = Boolean(item.imageRef) && !failed;

  return (
    <li className={styles.line}>
      <div className={styles.photo}>
        {showPhoto && item.imageRef ? (
          <Image src={productMediaUrl(item.imageRef)} alt="" fill unoptimized sizes="72px" onError={onImageError} />
        ) : (
          <span>{item.imageRef ? "This photo is unavailable right now" : "Product photo"}</span>
        )}
      </div>
      <div className={styles.details}>
        <Link className={styles.productLink} href={`/products/${item.productId}`} prefetch={false} onClick={onFollow}>
          <span dir="auto">{item.productNameAr}</span>
        </Link>
        <p className={styles.variant}>Size: <span dir="auto">{item.sizeNameAr}</span> <span aria-hidden="true">·</span> Color: <span dir="auto">{item.colorNameAr}</span></p>
        <p className={styles.qty}>Qty <strong>{item.quantity}</strong></p>
        <p className={styles.lineMerchandise}><span>Merchandise</span> <strong>{formatEgp(item.unitPricePiasters * item.quantity)}</strong></p>
        {unavailable ? <p className={styles.warning}>This selection was unavailable at its last check. Review the bag to refresh its availability.</p> : null}
        {excessive && item.knownAvailableQuantity > 0 ? <p className={styles.warning}>Last checked availability: {item.knownAvailableQuantity}. Review the bag to change the quantity.</p> : null}
      </div>
    </li>
  );
}

function BagIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M6.75 8.25h10.5l-.7 10.15a1 1 0 0 1-1 .85H8.45a1 1 0 0 1-1-.85l-.7-10.15Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 8.25V7a3 3 0 0 1 6 0v1.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

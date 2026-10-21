"use client";

import Image from "next/image";
import { useRef, useState, type KeyboardEvent, type TouchEvent } from "react";
import { productMediaUrl } from "../../public-catalog";
import styles from "./product-page.module.css";

type ProductGalleryProps = {
  productNameAr: string;
  imageRefs: string[];
};

export function ProductGallery({ productNameAr, imageRefs }: ProductGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<ReadonlySet<number>>(() => new Set());
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const imageCount = imageRefs.length;
  const selectedRef = imageRefs[selectedIndex];

  function move(offset: number) {
    if (imageCount < 2) return;
    setSelectedIndex((current) => (current + offset + imageCount) % imageCount);
  }

  function navigateByKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (imageCount < 2 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") setSelectedIndex(0);
    else if (event.key === "End") setSelectedIndex(imageCount - 1);
    else move(event.key === "ArrowRight" ? 1 : -1);
  }

  function finishSwipe(event: TouchEvent<HTMLDivElement>) {
    const start = touchStart.current;
    touchStart.current = null;
    const end = event.changedTouches[0];
    if (!start || !end) return;
    const horizontal = end.clientX - start.x;
    const vertical = end.clientY - start.y;
    if (Math.abs(horizontal) < 50 || Math.abs(horizontal) < Math.abs(vertical) * 1.5) return;
    move(horizontal < 0 ? 1 : -1);
  }

  function markFailed(index: number) {
    setFailedImages((previous) => {
      if (previous.has(index)) return previous;
      const next = new Set(previous);
      next.add(index);
      return next;
    });
  }

  return (
    <section className={styles.gallery} aria-label={`Photos of ${productNameAr}`} onKeyDown={navigateByKeyboard}>
      <div
        className={styles.mainFrame}
        tabIndex={imageCount > 1 ? 0 : undefined}
        aria-label={imageCount > 1 ? "Use the left and right arrow keys to browse product photos" : undefined}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          touchStart.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
        }}
        onTouchEnd={finishSwipe}
        onTouchCancel={() => { touchStart.current = null; }}
      >
        {selectedRef && !failedImages.has(selectedIndex) ? (
          <Image
            key={selectedIndex}
            src={productMediaUrl(selectedRef)}
            alt={`${productNameAr} — photo ${selectedIndex + 1}`}
            fill
            unoptimized
            priority={selectedIndex === 0}
            loading={selectedIndex === 0 ? undefined : "eager"}
            sizes="(max-width: 1023px) 94vw, 58vw"
            onError={() => markFailed(selectedIndex)}
          />
        ) : (
          <div className={styles.missingImage}>
            <span className={styles.mediaWordmark} aria-hidden="true">BRAVOS</span>
            <span>{imageCount === 0 ? "No photo for this product" : "This photo is unavailable right now"}</span>
          </div>
        )}
      </div>

      {imageCount > 1 ? (
        <div className={styles.navigation}>
          <button type="button" className={styles.stepButton} onClick={() => move(-1)} aria-label="Previous photo">
            Previous
          </button>
          <p className={styles.position} aria-live="polite" aria-atomic="true">
            Photo {selectedIndex + 1} of {imageCount}
          </p>
          <button type="button" className={styles.stepButton} onClick={() => move(1)} aria-label="Next photo">
            Next
          </button>
        </div>
      ) : null}

      {imageCount > 1 ? (
        <div className={styles.selectors} role="group" aria-label="Choose a product photo">
          {imageRefs.map((_, index) => (
            <button
              key={index}
              type="button"
              className={styles.selector}
              aria-label={`Show photo ${index + 1} of ${imageCount}`}
              aria-current={selectedIndex === index ? "true" : undefined}
              onClick={() => setSelectedIndex(index)}
            >
              <span className={styles.selectorNumber} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <span className={styles.selectorCaption} aria-hidden="true">Photo</span>
              <span className="sr-only">{index + 1}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

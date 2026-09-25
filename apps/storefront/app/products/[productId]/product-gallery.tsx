"use client";

import Image from "next/image";
import { useState } from "react";
import { productMediaUrl } from "../../public-catalog";
import styles from "./product-page.module.css";

type ProductGalleryProps = {
  productNameAr: string;
  imageRefs: string[];
};

export function ProductGallery({ productNameAr, imageRefs }: ProductGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<ReadonlySet<number>>(() => new Set());
  const imageCount = imageRefs.length;
  const selectedRef = imageRefs[selectedIndex];

  function move(offset: number) {
    setSelectedIndex((current) => (current + offset + imageCount) % imageCount);
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
    <section className={styles.gallery} aria-label={`صور ${productNameAr}`}>
      <div className={styles.mainFrame}>
        {selectedRef && !failedImages.has(selectedIndex) ? (
          <Image
            key={selectedIndex}
            src={productMediaUrl(selectedRef)}
            alt={`${productNameAr} — صورة ${selectedIndex + 1}`}
            fill
            unoptimized
            priority={selectedIndex === 0}
            loading={selectedIndex === 0 ? undefined : "eager"}
            sizes="(max-width: 800px) 94vw, 54vw"
            onError={() => markFailed(selectedIndex)}
          />
        ) : (
          <span className={styles.missingImage}>
            {imageCount === 0 ? "لا توجد صورة لهذا المنتج" : "هذه الصورة غير متاحة حالياً"}
          </span>
        )}
      </div>

      {imageCount > 1 ? (
        <div className={styles.navigation}>
          <button type="button" className={styles.stepButton} onClick={() => move(-1)} aria-label="الصورة السابقة">
            السابق
          </button>
          <p className={styles.position} aria-live="polite" aria-atomic="true">
            الصورة {selectedIndex + 1} من {imageCount}
          </p>
          <button type="button" className={styles.stepButton} onClick={() => move(1)} aria-label="الصورة التالية">
            التالي
          </button>
        </div>
      ) : null}

      {imageCount > 1 ? (
        <div className={styles.selectors} role="group" aria-label="اختيار صورة المنتج">
          {imageRefs.map((_, index) => (
            <button
              key={index}
              type="button"
              className={styles.selector}
              aria-label={`عرض الصورة ${index + 1} من ${imageCount}`}
              aria-current={selectedIndex === index ? "true" : undefined}
              onClick={() => setSelectedIndex(index)}
            >
              {index + 1}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./shop-wall.module.css";

type ProductMediaProps = {
  src: string | null;
  priority?: boolean;
  sizes?: string;
};

// Gutter clamp(16px, 4vw, 64px). One column below 390 so 12px price/status fit.
// Two columns from 390 until 900, four from 900. Phone wall inset tightens by 8px.
const WALL_IMAGE_SIZES = "(max-width: 389px) calc(100vw - 32px), (max-width: 480px) calc((100vw - 24px) / 2), (max-width: 899px) 45vw, (max-width: 1399px) 21.5vw, (max-width: 1599px) calc(23vw - 21px), calc((100vw - 212px) / 4)";

export function ProductMedia({ src, priority = false, sizes = WALL_IMAGE_SIZES }: ProductMediaProps) {
  const [failed, setFailed] = useState(false);

  return (
    <span className={styles.media} data-product-media>
      {src && !failed ? (
        <Image
          src={src}
          alt=""
          fill
          unoptimized
          priority={priority}
          loading={priority ? "eager" : "lazy"}
          sizes={sizes}
          style={{ objectFit: "cover", objectPosition: "center", padding: 0, margin: 0 }}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={styles.mediaFallback}>
          <span className={styles.fallbackWordmark} aria-hidden="true">BRAVOS</span>
          <span>Image unavailable</span>
        </span>
      )}
    </span>
  );
}

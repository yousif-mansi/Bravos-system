"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./shop-wall.module.css";

type ProductMediaProps = {
  src: string | null;
  priority?: boolean;
};

export function ProductMedia({ src, priority = false }: ProductMediaProps) {
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
          sizes="(max-width: 359px) calc(100vw - 32px), (max-width: 899px) calc((100vw - 48px) / 2), (max-width: 1399px) 50vw, 660px"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={styles.mediaFallback}>
          <span className={styles.fallbackWordmark} aria-hidden="true">BRAVOS</span>
          <span>الصورة غير متاحة</span>
        </span>
      )}
    </span>
  );
}

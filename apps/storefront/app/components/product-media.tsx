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
          sizes="(max-width: 359px) 100vw, (max-width: 767px) calc((100vw - 2px) / 2), (max-width: 1199px) calc((100vw - 4px) / 3), 309px"
          onError={() => setFailed(true)}
        />
      ) : <span className={styles.mediaFallback}>الصورة غير متاحة</span>}
    </span>
  );
}

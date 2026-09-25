import type { PublicProductSummaryDto } from "@bravos/contracts/public";
import Link from "next/link";
import { availabilityLabel, formatEgp, productMediaUrl } from "../public-catalog";
import { ProductMedia } from "./product-media";
import styles from "./shop-wall.module.css";

type ProductCardProps = {
  product: PublicProductSummaryDto;
  prioritizeMedia?: boolean;
};

export function ProductCard({ product, prioritizeMedia = false }: ProductCardProps) {
  const price = product.lowestSellingPricePiasters;

  return (
    <Link className={`${styles.card} product-card`} href={`/products/${product.id}`}>
      <ProductMedia
        key={product.previewImageRef ?? "missing"}
        src={product.previewImageRef ? productMediaUrl(product.previewImageRef) : null}
        priority={prioritizeMedia}
      />
      <div className={styles.caption}>
        <h3 className={styles.name}>{product.nameAr}</h3>
        <p className={styles.price}>
          {price === null ? "السعر عند الاختيار" : <><span className={styles.pricePrefix}>يبدأ من </span>{formatEgp(price)}</>}
        </p>
        <p className={product.availability === "in_stock" ? styles.available : styles.unavailable}>
          {availabilityLabel(product)}
        </p>
      </div>
    </Link>
  );
}

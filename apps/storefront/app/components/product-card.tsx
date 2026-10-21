import type { PublicProductAvailability, PublicProductSummaryDto } from "@bravos/contracts/public";
import Link from "next/link";
import { formatEgp, productMediaUrl } from "../public-catalog";
import { ProductMedia } from "./product-media";
import styles from "./shop-wall.module.css";

type ProductCardProps = {
  product: PublicProductSummaryDto;
  prioritizeMedia?: boolean;
  sizes?: string;
};

export function ProductCard({ product, prioritizeMedia = false, sizes }: ProductCardProps) {
  const price = product.lowestSellingPricePiasters;

  return (
    <Link className={`${styles.card} product-card`} href={`/products/${product.id}`} prefetch={false} data-product-id={product.id}>
      <ProductMedia
        key={product.previewImageRef ?? "missing"}
        src={product.previewImageRef ? productMediaUrl(product.previewImageRef) : null}
        priority={prioritizeMedia}
        sizes={sizes}
      />
      <div className={styles.caption}>
        <h3 className={styles.name} dir="auto" title={product.nameAr}>{product.nameAr}</h3>
        <div className={styles.meta}>
          <p className={styles.price}>
            {price === null ? "Price on selection" : <><span className={styles.pricePrefix}>From </span>{formatEgp(price)}</>}
          </p>
          <p className={styles.status} data-availability={product.availability}>{cardAvailabilityLabel(product.availability)}</p>
        </div>
      </div>
    </Link>
  );
}

function cardAvailabilityLabel(availability: PublicProductAvailability): string {
  switch (availability) {
    case "in_stock":
      return "In Stock";
    case "out_of_stock":
      return "Out of Stock";
    case "coming_soon":
      return "Coming Soon";
  }
}

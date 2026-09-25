import type { PublicProductSummaryDto } from "@bravos/contracts/public";
import { ProductCard } from "./product-card";
import styles from "./shop-wall.module.css";

type ShopWallProps = {
  products: PublicProductSummaryDto[];
  prioritizeLead?: boolean;
};

export function ShopWall({ products, prioritizeLead = false }: ShopWallProps) {
  return (
    <section aria-label="المنتجات" className={styles.wall}>
      <div className={styles.grid}>
        {products.map((product, index) => (
          <ProductCard key={product.id} product={product} prioritizeMedia={prioritizeLead && index === 0} />
        ))}
      </div>
      <p className={styles.note}>راجع سعر المقاس واللون وتوفرهما في صفحة المنتج.</p>
    </section>
  );
}

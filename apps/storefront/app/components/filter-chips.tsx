import Link from "next/link";
import { collectionHref, type CollectionSort } from "../collection-sort";
import styles from "./collection-controls.module.css";

type Props = {
  categoryId: string;
  categoryName?: string;
  sort: CollectionSort;
};

export function FilterChips({ categoryId, categoryName, sort }: Props) {
  if (!categoryId) return null;

  const categoryLabel = categoryName ?? "Unavailable category";

  return (
    <div className={styles.activeFilters}>
      <div className={styles.chips} aria-label="Active filters">
        <Link className={styles.chip} href={`${collectionHref({ sort })}#catalog-title`} aria-label={`Remove category: ${categoryLabel}`} prefetch={false}>
          <span dir="auto">Category: {categoryLabel}</span><span aria-hidden="true">×</span>
        </Link>
        <Link className={styles.clearAll} href={`${collectionHref({ sort })}#catalog-title`} prefetch={false}>Clear category</Link>
      </div>
    </div>
  );
}

import Link from "next/link";
import { collectionHref, type CollectionSort } from "../collection-sort";
import styles from "./collection-controls.module.css";

type Props = {
  query: string;
  categoryId: string;
  categoryName?: string;
  sort: CollectionSort;
  count: number;
};

export function FilterChips({ query, categoryId, categoryName, sort, count }: Props) {
  if (!query && !categoryId) return <p className={styles.count} role="status">{count} منتج</p>;

  return (
    <div className={styles.activeFilters}>
      <p className={styles.count} role="status">{count} منتج</p>
      <div className={styles.chips} aria-label="التصفية النشطة">
        {query ? (
          <Link className={styles.chip} href={collectionHref({ categoryId, sort })} aria-label={`إزالة البحث: ${query}`}>
            <span>بحث: {query}</span><span aria-hidden="true">×</span>
          </Link>
        ) : null}
        {categoryId ? (
          <Link className={styles.chip} href={collectionHref({ query, sort })} aria-label={`إزالة التصنيف: ${categoryName ?? "تصنيف غير متاح"}`}>
            <span>التصنيف: {categoryName ?? "تصنيف غير متاح"}</span><span aria-hidden="true">×</span>
          </Link>
        ) : null}
        <Link className={styles.clearAll} href={collectionHref({ sort })}>مسح كل التصفية</Link>
      </div>
    </div>
  );
}

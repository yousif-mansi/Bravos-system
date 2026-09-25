"use client";

import type { PublicCatalogOptionDto } from "@bravos/contracts/public";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ChangeEvent } from "react";
import { collectionHref, type CollectionSort } from "../collection-sort";
import styles from "./collection-controls.module.css";

type Props = {
  query: string;
  categoryId: string;
  categories: PublicCatalogOptionDto[];
  sort: CollectionSort;
};

export function CollectionControls({ query, categoryId, categories, sort }: Props) {
  const router = useRouter();

  function changeSort(event: ChangeEvent<HTMLSelectElement>) {
    const nextSort = event.target.value as CollectionSort;
    router.push(collectionHref({ query, categoryId, sort: nextSort }), { scroll: false });
  }

  return (
    <div className={styles.controls}>
      <div className={styles.toolbar}>
        <form className={styles.search} role="search" action="/" method="get">
          <label htmlFor="product-search">ابحث عن منتج</label>
          <div className={styles.searchRow}>
            <input id="product-search" name="q" key={query} defaultValue={query} maxLength={80} placeholder="اسم المنتج" />
            {categoryId ? <input type="hidden" name="category" value={categoryId} /> : null}
            {sort !== "default" ? <input type="hidden" name="sort" value={sort} /> : null}
            <button type="submit">بحث</button>
          </div>
        </form>
        <div className={styles.sort}>
          <label htmlFor="collection-sort">ترتيب المنتجات</label>
          <select id="collection-sort" value={sort} onChange={changeSort}>
            <option value="default">ترتيب المتجر</option>
            <option value="name">الاسم بالعربية</option>
            <option value="price-asc">السعر يبدأ من: الأقل</option>
            <option value="price-desc">السعر يبدأ من: الأعلى</option>
          </select>
        </div>
      </div>
      <nav className={styles.categories} aria-label="تصفية حسب التصنيف">
        <Link className={!categoryId ? styles.selected : undefined} aria-current={!categoryId ? "page" : undefined} href={collectionHref({ query, sort })}>كل التصنيفات</Link>
        {categories.map((category) => (
          <Link
            className={category.id === categoryId ? styles.selected : undefined}
            aria-current={category.id === categoryId ? "page" : undefined}
            href={collectionHref({ query, categoryId: category.id, sort })}
            key={category.id}
          >
            {category.nameAr}
          </Link>
        ))}
      </nav>
    </div>
  );
}

"use client";

import type { PublicCatalogOptionDto } from "@bravos/contracts/public";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useEffect, useState } from "react";
import { collectionHref, parseCollectionSort, type CollectionSort } from "../collection-sort";
import styles from "./collection-controls.module.css";

type Props = {
  categoryId: string;
  categories: PublicCatalogOptionDto[];
  sort: CollectionSort;
};

export function CollectionControls({ categoryId, categories, sort }: Props) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  function changeSort(event: ChangeEvent<HTMLSelectElement>) {
    const nextSort = parseCollectionSort(event.target.value);
    router.push(collectionHref({ categoryId, sort: nextSort }), { scroll: false });
  }

  return (
    <div className={styles.controls}>
      <div className={styles.toolbar}>
        <div className={styles.sort}>
          <label htmlFor="collection-sort">Sort</label>
          <select id="collection-sort" value={sort} onChange={changeSort} disabled={!mounted} aria-busy={!mounted}>
            <option value="default">Default order</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </select>
        </div>
      </div>
      <nav className={styles.categories} aria-label="Filter by category">
        <Link className={!categoryId ? styles.selected : undefined} aria-current={!categoryId ? "page" : undefined} href={`${collectionHref({ sort })}#catalog-title`} prefetch={false}>All categories</Link>
        {categories.map((category) => (
          <Link
            className={category.id === categoryId ? styles.selected : undefined}
            aria-current={category.id === categoryId ? "page" : undefined}
            href={collectionHref({ categoryId: category.id, sort })}
            key={category.id}
            prefetch={false}
            onFocus={(event) => {
              const link = event.currentTarget;
              const rail = link.parentElement?.getBoundingClientRect();
              const box = link.getBoundingClientRect();
              const headerBottom = document.querySelector(".store-header")?.getBoundingClientRect().bottom ?? 0;
              if (!rail || box.left < rail.left || box.right > rail.right || box.top < headerBottom || box.bottom > window.innerHeight) {
                link.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
              }
            }}
          >
            <span dir="auto">{category.nameAr}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

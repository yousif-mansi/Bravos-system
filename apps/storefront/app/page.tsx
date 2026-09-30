import Link from "next/link";
import { CollectionControls } from "./components/collection-controls";
import { FilterChips } from "./components/filter-chips";
import { ShopWall } from "./components/shop-wall";
import { HomeConfidence, HomeIntroduction } from "./components/home-introduction";
import { collectionHref, parseCollectionSort, sortCollection } from "./collection-sort";
import { browsePublicProducts } from "./public-catalog";
import styles from "./components/collection-controls.module.css";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ q?: string | string[]; category?: string | string[]; sort?: string | string[] }>;
};

export default async function Page({ searchParams }: PageProps) {
  const raw = await searchParams;
  const query = first(raw.q).trim();
  const categoryId = first(raw.category);
  const sort = parseCollectionSort(first(raw.sort));
  // A stale or hand-edited category still needs a removable filter instead of an API validation error.
  const categoryIsWellFormed = !categoryId || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(categoryId);
  const catalog = await browsePublicProducts({ query, categoryId: categoryIsWellFormed ? categoryId : undefined });
  const activeCategory = catalog.categories.find((category) => category.id === categoryId);
  const products = categoryIsWellFormed ? sortCollection(catalog.products, sort) : [];
  const isCollectionView = Boolean(query || categoryId || sort !== "default");

  return (
    <main id="main-content">
      {!isCollectionView ? <HomeIntroduction categories={catalog.categories} /> : null}
      <section className="browse-panel" aria-labelledby="catalog-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">التشكيلة / اختر تفاصيلك</p>
            {isCollectionView ? <h1 id="catalog-title" className={styles.collectionTitle}>كل المنتجات</h1> : <h2 id="catalog-title">كل المنتجات</h2>}
          </div>
        </div>
        <CollectionControls query={query} categoryId={categoryId} categories={catalog.categories} sort={sort} />
        <FilterChips
          query={query}
          categoryId={categoryId}
          categoryName={activeCategory?.nameAr}
          sort={sort}
          count={products.length}
        />
        {products.length === 0 ? (
          <div className={styles.message}>
            <h2>لا توجد منتجات مطابقة</h2>
            <p>{query ? "جرّب عبارة بحث أخرى أو امسح التصفية لعرض المنتجات." : "جرّب تصنيفاً آخر أو اعرض كل المنتجات."}</p>
            <Link className="button-link" href={collectionHref({ sort })}>عرض كل المنتجات</Link>
          </div>
        ) : <ShopWall products={products} prioritizeLead={isCollectionView} />}
      </section>
      {!isCollectionView ? <HomeConfidence /> : null}
    </main>
  );
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

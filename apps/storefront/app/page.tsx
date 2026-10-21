import type { Metadata } from "next";
import type { PublicCatalogBrowseDto, PublicProductSummaryDto } from "@bravos/contracts/public";
import Link from "next/link";
import { CategoryRails, type CategoryRailModel } from "./components/category-rails";
import { CollectionControls } from "./components/collection-controls";
import { FilterChips } from "./components/filter-chips";
import { ShopWall } from "./components/shop-wall";
import { HomeConfidence, HomeIntroduction } from "./components/home-introduction";
import { collectionHref, parseCollectionSort, sortCollection, type CollectionSort } from "./collection-sort";
import { browsePublicProducts } from "./public-catalog";
import { collectionPageMetadata, homePageMetadata } from "./storefront-metadata";
import styles from "./components/collection-controls.module.css";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ category?: string | string[]; sort?: string | string[] }>;
};

type HomeView = {
  mode: "home";
  sort: CollectionSort;
  categories: PublicCatalogBrowseDto["categories"];
  rails: CategoryRailModel[];
};

type CategoryView = {
  mode: "category";
  sort: CollectionSort;
  categoryId: string;
  title: string;
  categories: PublicCatalogBrowseDto["categories"];
  categoryName?: string;
  products: PublicProductSummaryDto[];
};

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const raw = await searchParams;
  const categoryId = first(raw.category);
  const sort = parseCollectionSort(first(raw.sort));
  if (!categoryId && sort === "default") return homePageMetadata();
  if (!categoryId) return collectionPageMetadata("Shop by category", collectionHref({ sort }));
  const view = await collectionView(Promise.resolve(raw));
  if (view.mode !== "category") return homePageMetadata();
  return collectionPageMetadata(view.title, collectionHref({ categoryId: view.categoryId, sort: view.sort }));
}

export default async function Page({ searchParams }: PageProps) {
  const view = await collectionView(searchParams);
  if (view.mode === "home") {
    return (
      <main id="main-content" className="home-page">
        <HomeIntroduction />
        <section className="browse-panel" aria-labelledby="catalog-title">
          <div className="section-heading">
            <div>
              <h2 id="catalog-title">Shop by category</h2>
            </div>
          </div>
          <CollectionControls categoryId="" categories={view.categories} sort={view.sort} />
          {view.rails.length === 0 ? (
            <div className={styles.message}>
              <h2>No products available</h2>
              <p>Please check back later.</p>
            </div>
          ) : <CategoryRails key={view.sort} rails={view.rails} sort={view.sort} />}
        </section>
        <HomeConfidence />
      </main>
    );
  }

  return (
    <main id="main-content">
      <section className="browse-panel" aria-labelledby="catalog-title">
        <div className="section-heading">
          <div>
            <h1 id="catalog-title" className={styles.collectionTitle} dir="auto">{view.title}</h1>
          </div>
        </div>
        <CollectionControls categoryId={view.categoryId} categories={view.categories} sort={view.sort} />
        <FilterChips categoryId={view.categoryId} categoryName={view.categoryName} sort={view.sort} />
        {view.products.length === 0 ? (
          <div className={styles.message}>
            <h2>No matching products</h2>
            <p>Try another category, or view the categories.</p>
            <Link className="button-link" href={`${collectionHref({ sort: view.sort })}#catalog-title`} prefetch={false}>Categories</Link>
          </div>
        ) : <ShopWall products={view.products} prioritizeLead />}
      </section>
    </main>
  );
}

async function collectionView(searchParams: PageProps["searchParams"]): Promise<HomeView | CategoryView> {
  const raw = await searchParams;
  const categoryId = first(raw.category);
  const sort = parseCollectionSort(first(raw.sort));
  const categoryIsWellFormed = !categoryId || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(categoryId);
  const catalog = await browsePublicProducts({ categoryId: categoryIsWellFormed && categoryId ? categoryId : undefined });
  if (!categoryId) {
    return { mode: "home", sort, categories: catalog.categories, rails: categoryRails(catalog, sort) };
  }
  const activeCategory = catalog.categories.find((category) => category.id === categoryId);
  return {
    mode: "category",
    sort,
    categoryId,
    title: activeCategory?.nameAr ?? "Unavailable category",
    categories: catalog.categories,
    categoryName: activeCategory?.nameAr,
    products: categoryIsWellFormed ? sortCollection(catalog.products, sort) : [],
  };
}

function categoryRails(catalog: PublicCatalogBrowseDto, sort: CollectionSort): CategoryRailModel[] {
  const groups = new Map<string, PublicProductSummaryDto[]>();
  for (const product of catalog.products) {
    const group = groups.get(product.category.id);
    if (group) group.push(product);
    else groups.set(product.category.id, [product]);
  }
  const orderedIds = [...catalog.categories.map((category) => category.id)];
  for (const id of groups.keys()) {
    if (!orderedIds.includes(id)) orderedIds.push(id);
  }
  const rails: CategoryRailModel[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const group = groups.get(id);
    if (!group || group.length === 0) continue;
    const nameAr = catalog.categories.find((category) => category.id === id)?.nameAr ?? group[0]?.category.nameAr ?? "";
    const sorted = sortCollection(group, sort);
    if (rails.length === 0) {
      const initialProducts = sorted.slice(0, 4);
      rails.push({ id, nameAr, hasMore: sorted.length > initialProducts.length, initialProducts });
    } else {
      rails.push({ id, nameAr, hasMore: true });
    }
  }
  return rails;
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

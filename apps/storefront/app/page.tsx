import Image from "next/image";
import Link from "next/link";
import { availabilityLabel, browsePublicProducts, formatEgp, productMediaUrl } from "./public-catalog";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ q?: string | string[]; category?: string | string[] }>;
};

export default async function Page({ searchParams }: PageProps) {
  const raw = await searchParams;
  const query = first(raw.q);
  const categoryId = first(raw.category);
  const catalog = await browsePublicProducts({ query, categoryId });
  const activeCategory = catalog.categories.find((category) => category.id === categoryId);

  return (
    <main id="main-content">
      <section className="hero">
        <p className="eyebrow">برافوس للملابس الرجالي</p>
        <h1>اختيارات هادئة.<br />حضور واضح.</h1>
        <p>تصفّح التشكيلة واختر المقاس واللون المناسبين قبل تجهيز طلبك.</p>
      </section>
      <section className="browse-panel" aria-labelledby="catalog-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">التشكيلة</p>
            <h2 id="catalog-title">كل المنتجات</h2>
          </div>
          <form className="search-form" role="search">
            <label htmlFor="product-search">ابحث عن منتج</label>
            <div>
              <input id="product-search" name="q" defaultValue={query} maxLength={80} placeholder="قميص، جاكيت…" />
              {categoryId ? <input type="hidden" name="category" value={categoryId} /> : null}
              <button type="submit">بحث</button>
            </div>
          </form>
        </div>
        <nav className="category-list" aria-label="تصفية حسب التصنيف">
          <Link className={!activeCategory ? "active" : ""} href={homeHref(query, "")}>الكل</Link>
          {catalog.categories.map((category) => (
            <Link
              className={category.id === categoryId ? "active" : ""}
              href={homeHref(query, category.id)}
              key={category.id}
            >
              {category.nameAr}
            </Link>
          ))}
        </nav>
        {query || activeCategory ? (
          <div className="filter-summary" role="status">
            <span>{catalog.products.length} منتج</span>
            {query ? <span>نتائج «{query}»</span> : null}
            {activeCategory ? <span>في {activeCategory.nameAr}</span> : null}
            <Link href="/">مسح التصفية</Link>
          </div>
        ) : null}
        {catalog.products.length === 0 ? (
          <div className="empty-state">
            <h3>لا توجد نتائج مطابقة</h3>
            <p>جرّب عبارة أخرى أو اعرض كل التصنيفات.</p>
            <Link className="button-link" href="/">عرض كل المنتجات</Link>
          </div>
        ) : (
          <section className="product-grid" aria-label="المنتجات">
            {catalog.products.map((product, index) => (
              <Link className="product-card" href={`/products/${product.id}`} key={product.id}>
                <div className="photo-frame">
                  {product.previewImageRef ? (
                    <Image
                      src={productMediaUrl(product.previewImageRef)}
                      alt=""
                      fill
                      unoptimized
                      priority={index === 0}
                      sizes="(max-width: 640px) 92vw, (max-width: 1024px) 45vw, 31vw"
                    />
                  ) : <span className="photo-placeholder">صورة المنتج</span>}
                  <span className={`availability-badge ${product.availability}`}>{availabilityLabel(product)}</span>
                </div>
                <div className="card-copy">
                  <p>{product.category.nameAr}</p>
                  <h3>{product.nameAr}</h3>
                  <strong>{product.lowestSellingPricePiasters === null ? "السعر عند الاختيار" : formatEgp(product.lowestSellingPricePiasters)}</strong>
                </div>
              </Link>
            ))}
          </section>
        )}
      </section>
    </main>
  );
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function homeHref(query: string, categoryId: string): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (categoryId) params.set("category", categoryId);
  const suffix = params.toString();
  return suffix ? `/?${suffix}` : "/";
}

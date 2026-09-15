import Image from "next/image";
import Link from "next/link";
import { availabilityLabel, formatEgp, listPublicProducts, productMediaUrl } from "./public-catalog";

export const dynamic = "force-dynamic";

export default async function Page() {
  const products = await listPublicProducts();
  return (
    <main>
      <section style={{ paddingTop: "2rem" }}>
        <p className="eyebrow">تشكيلة برافوس</p>
        <h1>اختر إطلالتك</h1>
      </section>
      {products.length === 0 ? (
        <p className="muted">لا توجد منتجات منشورة حالياً.</p>
      ) : (
        <section className="product-grid" aria-label="المنتجات">
          {products.map((product) => {
            const prices = product.variants.map((variant) => variant.sellingPricePiasters);
            const lowestPrice = prices.length > 0 ? Math.min(...prices) : 0;
            return (
              <Link className="product-card" href={`/products/${product.id}`} key={product.id}>
                <div className="photo-frame">
                  {product.imageRefs[0] ? (
                    <Image
                      src={productMediaUrl(product.imageRefs[0])}
                      alt={product.nameAr}
                      fill
                      unoptimized
                      sizes="(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 33vw"
                    />
                  ) : <span className="photo-placeholder">صورة المنتج</span>}
                </div>
                <div>
                  <span className="badge">{availabilityLabel(product)}</span>
                  <h2>{product.nameAr}</h2>
                  <p className="muted">{product.category.nameAr}</p>
                  <strong>{formatEgp(lowestPrice)}</strong>
                </div>
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}

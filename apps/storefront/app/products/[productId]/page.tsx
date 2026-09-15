import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { availabilityLabel, getPublicProduct, productMediaUrl } from "../../public-catalog";
import { ProductPurchasePanel } from "./product-purchase-panel";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await getPublicProduct(productId);
  if (!product) notFound();

  return (
    <main id="main-content" className="product-page">
      <nav className="breadcrumbs" aria-label="مسار الصفحة">
        <Link href="/">المتجر</Link><span aria-hidden="true">/</span><span>{product.category.nameAr}</span>
      </nav>
      <section className="gallery" aria-label={`صور ${product.nameAr}`}>
        {product.imageRefs.length > 0 ? product.imageRefs.map((ref, index) => (
          <div className="photo-frame" key={ref}>
            <Image
              src={productMediaUrl(ref)}
              alt={`${product.nameAr} — صورة ${index + 1}`}
              fill
              unoptimized
              priority={index === 0}
              sizes="(max-width: 799px) 94vw, 54vw"
            />
          </div>
        )) : <div className="photo-frame"><span className="photo-placeholder">صورة المنتج</span></div>}
      </section>
      <section className="product-copy">
        <p className="eyebrow">{product.category.nameAr}</p>
        <h1>{product.nameAr}</h1>
        <span className={`availability-badge inline ${product.availability}`}>{availabilityLabel(product)}</span>
        {product.descriptionAr ? <p className="description">{product.descriptionAr}</p> : null}
        {product.availability === "coming_soon" ? <p className="availability-note">هذا المنتج للعرض المسبق وسيكون متاحاً للطلب لاحقاً.</p> : null}
        {product.availability === "out_of_stock" ? <p className="availability-note">المنتج غير متوفر حالياً، ويمكنك تصفح تفاصيله.</p> : null}
        <ProductPurchasePanel product={{
          id: product.id,
          nameAr: product.nameAr,
          orderable: product.orderable,
          imageRef: product.imageRefs[0] ?? null,
          variants: product.variants,
        }} />
        {product.sizeGuideAr ? (
          <details className="size-guide" open>
            <summary>دليل المقاسات</summary>
            <p>{product.sizeGuideAr}</p>
          </details>
        ) : null}
      </section>
    </main>
  );
}

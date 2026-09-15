import Image from "next/image";
import { notFound } from "next/navigation";
import { availabilityLabel, formatEgp, getPublicProduct, productMediaUrl } from "../../public-catalog";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await getPublicProduct(productId);
  if (!product) {
    notFound();
  }
  return (
    <main className="product-page">
      <section className="gallery" aria-label={`صور ${product.nameAr}`}>
        {product.imageRefs.length > 0 ? product.imageRefs.map((ref, index) => (
          <div className="photo-frame" key={ref}>
            <Image
              src={productMediaUrl(ref)}
              alt={`${product.nameAr} — صورة ${index + 1}`}
              fill
              unoptimized
              priority={index === 0}
              sizes="(max-width: 799px) 100vw, 55vw"
            />
          </div>
        )) : <div className="photo-frame"><span className="photo-placeholder">صورة المنتج</span></div>}
      </section>
      <section className="product-copy">
        <p className="eyebrow">{product.category.nameAr}</p>
        <h1>{product.nameAr}</h1>
        <span className="badge">{availabilityLabel(product)}</span>
        {product.descriptionAr ? <p>{product.descriptionAr}</p> : null}
        <fieldset className="variant-picker" disabled={!product.orderable}>
          <legend>اختر المقاس واللون</legend>
          {product.variants.map((variant) => (
            <label className="variant-option" key={variant.id}>
              <input type="radio" name="variant" value={variant.id} disabled={!variant.orderable} />
              <span>{variant.size.nameAr} / {variant.color.nameAr}</span>
              <strong>{formatEgp(variant.sellingPricePiasters)}</strong>
              {!variant.orderable ? <span>— غير متوفر</span> : null}
            </label>
          ))}
        </fieldset>
        {product.availability === "coming_soon" ? <p>هذا المنتج للعرض المسبق وسيكون متاحاً للطلب لاحقاً.</p> : null}
        {product.availability === "out_of_stock" ? <p>المنتج غير متوفر حالياً، ويمكنك تصفح تفاصيله.</p> : null}
        {product.sizeGuideAr ? (
          <section>
            <h2>دليل المقاسات</h2>
            <p className="size-guide">{product.sizeGuideAr}</p>
          </section>
        ) : null}
      </section>
    </main>
  );
}

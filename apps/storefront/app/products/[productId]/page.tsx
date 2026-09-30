import Link from "next/link";
import { notFound } from "next/navigation";
import { availabilityLabel, getPublicProduct } from "../../public-catalog";
import { ProductGallery } from "./product-gallery";
import { ProductPurchasePanel } from "./product-purchase-panel";
import { ProductViewAnalytics } from "../../storefront-analytics";
import styles from "./product-page.module.css";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await getPublicProduct(productId);
  if (!product) notFound();

  return (
    <main id="main-content" className={styles.page}>
      <ProductViewAnalytics productId={product.id} />
      <nav className={`breadcrumbs ${styles.breadcrumbs}`} aria-label="مسار الصفحة">
        <Link href="/">المتجر</Link><span aria-hidden="true">/</span>
        <Link href={`/?category=${encodeURIComponent(product.category.id)}`}>{product.category.nameAr}</Link>
        <span aria-hidden="true">/</span><span aria-current="page">{product.nameAr}</span>
      </nav>
      <ProductPurchasePanel
        gallery={<ProductGallery key={JSON.stringify([product.id, product.imageRefs])} productNameAr={product.nameAr} imageRefs={product.imageRefs} />}
        introduction={(
          <>
            <p className={`eyebrow ${styles.eyebrow}`}>{product.category.nameAr}</p>
            <h1>{product.nameAr}</h1>
            <span className={`availability-badge inline ${product.availability} ${styles.availability}`}>{availabilityLabel(product)}</span>
            {product.availability === "coming_soon" ? <p className={styles.availabilityNote}>هذا المنتج للعرض المسبق وسيكون متاحاً للطلب لاحقاً.</p> : null}
            {product.availability === "out_of_stock" ? <p className={styles.availabilityNote}>المنتج غير متوفر حالياً، ويمكنك تصفح تفاصيله.</p> : null}
          </>
        )}
        product={{
          id: product.id,
          nameAr: product.nameAr,
          orderable: product.orderable,
          imageRef: product.imageRefs[0] ?? null,
          variants: product.variants,
        }}
        sizeGuide={product.descriptionAr || product.sizeGuideAr ? (
          <>
            {product.descriptionAr ? (
              <details className={styles.chapter} open>
                <summary>عن القطعة</summary>
                <p>{product.descriptionAr}</p>
              </details>
            ) : null}
            {product.sizeGuideAr ? (
              <details className={`size-guide ${styles.chapter}`} open>
                <summary>دليل المقاسات</summary>
                <p>{product.sizeGuideAr}</p>
              </details>
            ) : null}
          </>
        ) : null}
      />
    </main>
  );
}

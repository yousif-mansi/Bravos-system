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
      <nav className="breadcrumbs" aria-label="مسار الصفحة">
        <Link href="/">المتجر</Link><span aria-hidden="true">/</span><span>{product.category.nameAr}</span>
      </nav>
      <ProductPurchasePanel
        gallery={<ProductGallery key={JSON.stringify([product.id, product.imageRefs])} productNameAr={product.nameAr} imageRefs={product.imageRefs} />}
        introduction={(
          <>
            <p className="eyebrow">{product.category.nameAr}</p>
            <h1>{product.nameAr}</h1>
            <span className={`availability-badge inline ${product.availability}`}>{availabilityLabel(product)}</span>
            {product.descriptionAr ? <p className="description">{product.descriptionAr}</p> : null}
            {product.availability === "coming_soon" ? <p className="availability-note">هذا المنتج للعرض المسبق وسيكون متاحاً للطلب لاحقاً.</p> : null}
            {product.availability === "out_of_stock" ? <p className="availability-note">المنتج غير متوفر حالياً، ويمكنك تصفح تفاصيله.</p> : null}
          </>
        )}
        product={{
          id: product.id,
          nameAr: product.nameAr,
          orderable: product.orderable,
          imageRef: product.imageRefs[0] ?? null,
          variants: product.variants,
        }}
        sizeGuide={product.sizeGuideAr ? (
          <details className="size-guide" open>
            <summary>دليل المقاسات</summary>
            <p>{product.sizeGuideAr}</p>
          </details>
        ) : null}
      />
    </main>
  );
}

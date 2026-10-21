import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { availabilityLabel, getPublicProduct } from "../../public-catalog";
import { productPageMetadata, productStructuredData, serializeJsonLd } from "../../storefront-metadata";
import { ProductGallery } from "./product-gallery";
import { ProductPurchasePanel } from "./product-purchase-panel";
import { ProductViewAnalytics } from "../../storefront-analytics";
import styles from "./product-page.module.css";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ productId: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const product = await loadProduct(params);
  return productPageMetadata(product);
}

export default async function ProductPage({ params }: PageProps) {
  const product = await loadProduct(params);

  return (
    <main id="main-content" className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(productStructuredData(product)) }} />
      <ProductViewAnalytics productId={product.id} />
      <nav className={`breadcrumbs ${styles.breadcrumbs}`} aria-label="Breadcrumb">
        <Link href="/">Shop</Link><span aria-hidden="true">/</span>
        <Link href={`/?category=${encodeURIComponent(product.category.id)}`} dir="auto" prefetch={false}>{product.category.nameAr}</Link>
        <span aria-hidden="true">/</span><span aria-current="page" dir="auto">{product.nameAr}</span>
      </nav>
      <ProductPurchasePanel
        gallery={<ProductGallery key={JSON.stringify([product.id, product.imageRefs])} productNameAr={product.nameAr} imageRefs={product.imageRefs} />}
        introduction={(
          <>
            <p className={`eyebrow ${styles.eyebrow}`} dir="auto">{product.category.nameAr}</p>
            <h1 dir="auto">{product.nameAr}</h1>
            <span className={`availability-badge inline ${product.availability} ${styles.availability}`}>{availabilityLabel(product)}</span>
            {product.availability === "coming_soon" ? <p className={styles.availabilityNote}>Coming soon. Not available to order yet.</p> : null}
            {product.availability === "out_of_stock" ? <p className={styles.availabilityNote}>Out of stock. Product details are still available.</p> : null}
          </>
        )}
        product={{
          id: product.id,
          nameAr: product.nameAr,
          orderable: product.orderable,
          imageRef: product.imageRefs[0] ?? null,
          variants: product.variants,
        }}
        sizeGuide={(
          <>
            {product.descriptionAr ? (
              <details className={styles.chapter} open>
                <summary>Product details</summary>
                <p>{product.descriptionAr}</p>
              </details>
            ) : null}
            <p className={styles.confidence}>Pay on delivery. See the delivery fee at checkout. We confirm availability and your order on WhatsApp.</p>
            {product.sizeGuideAr ? (
              <details className={`size-guide ${styles.chapter}`} open>
                <summary>Size guide</summary>
                <p>{product.sizeGuideAr}</p>
              </details>
            ) : null}
          </>
        )}
      />
    </main>
  );
}

async function loadProduct(params: PageProps["params"]) {
  const { productId } = await params;
  const product = await getPublicProduct(productId);
  if (!product) notFound();
  return product;
}

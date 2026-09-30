import Image from "next/image";
import Link from "next/link";
import type { PublicCatalogOptionDto } from "@bravos/contracts/public";
import { collectionHref } from "../collection-sort";
import styles from "./home-introduction.module.css";

export function HomeIntroduction({ categories }: { categories: PublicCatalogOptionDto[] }) {
  return (
    <>
      <section className={styles.arrival} aria-labelledby="home-title">
        <div className={styles.heading}>
          <p className="eyebrow">برافوس · ملابس رجالي · الفيوم</p>
          <p className={styles.display} lang="en" dir="ltr" aria-hidden="true">OWN YOUR<br /><span>PRESENCE.</span></p>
          <h1 id="home-title">اختيارات هادئة. حضور واضح.</h1>
        </div>
        <div className={styles.cover}>
          <Image src="/brand/cover.jpg" alt="برافوس للملابس الرجالي" width={2048} height={774} priority sizes="(max-width: 1240px) 100vw, 1240px" />
        </div>
        <div className={styles.afterCover}>
          <p>ابدأ بقطعة تناسبك. اختر المقاس واللون، وراجع تفاصيل طلبك على مهل.</p>
          <a className="button-link" href="#catalog-title">اكتشف التشكيلة <span aria-hidden="true">↙</span></a>
        </div>
      </section>
      {categories.length > 0 ? (
        <section className={styles.collections} aria-labelledby="collections-title">
          <div className={styles.sectionTitle}>
            <p className={styles.index} lang="en" dir="ltr">01 / EXPLORE</p>
            <h2 id="collections-title">ابدأ من اختيارك</h2>
            <p>تصفّح التصنيفات الموجودة في المتجر.</p>
          </div>
          <nav className={styles.categoryGrid} aria-label="اكتشف تصنيفات المتجر">
            {categories.map((category, index) => (
              <Link key={category.id} href={collectionHref({ categoryId: category.id })}>
                <span className={styles.index} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <span>{category.nameAr}</span><span className={styles.arrow} aria-hidden="true">↙</span>
              </Link>
            ))}
          </nav>
        </section>
      ) : null}
    </>
  );
}

export function HomeConfidence() {
  return (
    <section className={styles.confidence} aria-labelledby="confidence-title">
      <div className={styles.brandStatement}>
        <p className={styles.index} lang="en" dir="ltr">BRAVOS / MEN’S WEAR</p>
        <h2 id="confidence-title">اختيارك يبدأ هنا.<br />والتفاصيل تفرق.</h2>
        <p>برافوس للملابس الرجالي في الفيوم. تصفّح القطع، راجع المقاسات والألوان المتاحة، واختر ما يناسبك.</p>
      </div>
      <div className={styles.steps}>
        <article><span className={styles.index} aria-hidden="true">01</span><h3>اختر القطعة</h3><p>السعر والتوفر حسب المقاس واللون في صفحة المنتج.</p></article>
        <article><span className={styles.index} aria-hidden="true">02</span><h3>راجع طلبك</h3><p>اختر منطقة التوصيل وراجع الرسوم والإجمالي قبل الإرسال.</p></article>
        <article><span className={styles.index} aria-hidden="true">03</span><h3>التأكيد عبر واتساب</h3><p>نتواصل لتأكيد توفر القطع والطلب. الدفع نقداً عند الاستلام.</p></article>
      </div>
    </section>
  );
}

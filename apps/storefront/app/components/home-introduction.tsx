import Image from "next/image";
import { BrandMarquee } from "./brand-marquee";
import styles from "./home-introduction.module.css";

export function HomeIntroduction() {
  return (
    <>
      <section className={styles.hero} aria-labelledby="home-title">
        <h1 id="home-title" className="sr-only">Bravos Menswear</h1>
        <div className={styles.heroMedia}>
          <Image
            className={styles.heroImage}
            src="/brand/cover.jpg"
            alt=""
            width={2048}
            height={774}
            priority
            sizes="100vw"
          />
        </div>
      </section>
      <BrandMarquee />
    </>
  );
}

export function HomeConfidence() {
  return (
    <section className={styles.confidence} aria-labelledby="confidence-title">
      <h2 id="confidence-title">How an order works</h2>
      <div className={styles.topics}>
        <article>
          <h3>WhatsApp confirmation</h3>
          <p>Your order starts as a request. Items are not reserved until confirmation. We confirm availability with you on WhatsApp.</p>
        </article>
        <article>
          <h3>Pay on delivery</h3>
          <p>See the delivery fee and total before you submit. Pay cash on delivery.</p>
        </article>
      </div>
    </section>
  );
}

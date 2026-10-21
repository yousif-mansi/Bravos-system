"use client";

import type { PublicCatalogBrowseDto, PublicProductSummaryDto } from "@bravos/contracts/public";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { collectionHref, sortCollection, type CollectionSort } from "../collection-sort";
import { ProductCard } from "./product-card";
import styles from "./category-rails.module.css";

const BATCH = 4;
const RAIL_IMAGE_SIZES = "(max-width: 699px) min(72vw, 220px), (max-width: 1099px) min(42vw, 240px), 260px";

export type CategoryRailModel = {
  id: string;
  nameAr: string;
  hasMore: boolean;
  initialProducts?: PublicProductSummaryDto[];
};

type LoadIntent = "prefetch" | "advance";

export function CategoryRails({ rails, sort }: { rails: readonly CategoryRailModel[]; sort: CollectionSort }) {
  if (rails.length === 0) return null;
  return (
    <div className={styles.rails}>
      {rails.map((category) => (
        <CategoryRail key={category.id} category={category} sort={sort} />
      ))}
    </div>
  );
}

function CategoryRail({ category, sort }: { category: CategoryRailModel; sort: CollectionSort }) {
  const seeded = category.initialProducts ?? [];
  const [products, setProducts] = useState<PublicProductSummaryDto[]>(seeded);
  const [visibleCount, setVisibleCount] = useState(seeded.length);
  const [fetched, setFetched] = useState(!category.hasMore);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">(
    seeded.length > 0 || !category.hasMore ? "ready" : "idle",
  );
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const railRef = useRef<HTMLUListElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const productsRef = useRef(products);
  const visibleRef = useRef(visibleCount);
  const fetchedRef = useRef(fetched);
  const sortRef = useRef(sort);
  const loadingRef = useRef(false);
  const pendingAdvanceRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const serialRef = useRef(0);
  const ioStartedRef = useRef(false);
  const endArmedRef = useRef(true);
  const pendingNextScrollRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const programmaticTokenRef = useRef(0);
  const focusRevealFrameRef = useRef<number | null>(null);
  const focusRevealEnabledRef = useRef(false);
  const ensureLoadedRef = useRef<(intent: LoadIntent) => Promise<void>>(async () => {});
  const railId = `category-rail-${category.id}`;
  const headingId = `category-heading-${category.id}`;

  productsRef.current = products;
  visibleRef.current = visibleCount;
  fetchedRef.current = fetched;
  sortRef.current = sort;

  function cancelPendingNextScroll() {
    pendingNextScrollRef.current = false;
  }

  async function ensureLoaded(intent: LoadIntent) {
    if (fetchedRef.current) {
      if (intent === "advance" && !revealAnother()) cancelPendingNextScroll();
      return;
    }
    if (loadingRef.current) {
      if (intent === "advance") pendingAdvanceRef.current = true;
      return;
    }
    const serial = ++serialRef.current;
    const sortAtStart = sortRef.current;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    loadingRef.current = true;
    setPhase("loading");
    try {
      const response = await fetch(
        `/api/public/storefront/catalog?categoryId=${encodeURIComponent(category.id)}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) throw new Error("catalog");
      const body: unknown = await response.json();
      if (controller.signal.aborted || serial !== serialRef.current || sortRef.current !== sortAtStart) {
        cancelPendingNextScroll();
        return;
      }
      const parsed = readSummaries(body, category.id);
      if (!parsed) throw new Error("catalog");
      const sorted = sortCollection(parsed, sortAtStart);
      const advance = intent === "advance" || pendingAdvanceRef.current;
      pendingAdvanceRef.current = false;
      const current = visibleRef.current;
      const nextVisible = current === 0
        ? Math.min(BATCH, sorted.length)
        : advance
          ? Math.min(sorted.length, current + BATCH)
          : current;
      const safeVisible = includeFocused(sorted, nextVisible);
      if (safeVisible === current) cancelPendingNextScroll();
      fetchedRef.current = true;
      productsRef.current = sorted;
      visibleRef.current = safeVisible;
      setFetched(true);
      setProducts(sorted);
      setVisibleCount(safeVisible);
      setPhase("ready");
    } catch {
      if (controller.signal.aborted || serial !== serialRef.current) {
        cancelPendingNextScroll();
        return;
      }
      pendingAdvanceRef.current = false;
      cancelPendingNextScroll();
      setPhase("error");
    } finally {
      if (abortRef.current === controller) loadingRef.current = false;
    }
  }
  ensureLoadedRef.current = ensureLoaded;

  function revealAnother() {
    const next = Math.min(productsRef.current.length, visibleRef.current + BATCH);
    const safe = includeFocused(productsRef.current, next);
    if (safe === visibleRef.current) return false;
    visibleRef.current = safe;
    setVisibleCount(safe);
    return true;
  }

  function cancelFocusedCardReveal() {
    if (focusRevealFrameRef.current === null) return;
    cancelAnimationFrame(focusRevealFrameRef.current);
    focusRevealFrameRef.current = null;
  }

  function releaseFocusedCardReveal() {
    focusRevealEnabledRef.current = false;
    cancelFocusedCardReveal();
  }

  function scheduleFocusedCardReveal(rail: HTMLUListElement) {
    if (!focusRevealEnabledRef.current) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLAnchorElement) || !rail.contains(active) || !active.matches(":focus-visible")) return;
    if (focusRevealFrameRef.current !== null) return;
    focusRevealFrameRef.current = requestAnimationFrame(() => {
      focusRevealFrameRef.current = null;
      if (!focusRevealEnabledRef.current) return;
      const anchor = document.activeElement;
      if (!(anchor instanceof HTMLAnchorElement) || !anchor.matches(":focus-visible")) return;
      if (!rail.isConnected || !anchor.isConnected || !rail.contains(anchor)) return;
      const card = anchor.getBoundingClientRect();
      const style = getComputedStyle(anchor);
      const extent = Math.max(0, Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)) + 1;
      const innerLeft = rail.getBoundingClientRect().left + rail.clientLeft;
      const innerRight = innerLeft + rail.clientWidth;
      const overflowLeft = card.left - extent - innerLeft;
      const overflowRight = card.right + extent - innerRight;
      const delta = overflowLeft < 0 ? overflowLeft : overflowRight > 0 ? overflowRight : 0;
      if (delta === 0) return;
      const before = rail.scrollLeft;
      const token = ++programmaticTokenRef.current;
      programmaticScrollRef.current = true;
      rail.scrollBy({ left: delta, behavior: "instant" });
      if (Math.abs(rail.scrollLeft - before) < 1) {
        if (programmaticTokenRef.current === token) programmaticScrollRef.current = false;
        return;
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (programmaticTokenRef.current === token) programmaticScrollRef.current = false;
        });
      });
    });
  }

  useEffect(() => () => {
    releaseFocusedCardReveal();
    cancelPendingNextScroll();
    pendingAdvanceRef.current = false;
    programmaticTokenRef.current += 1;
    programmaticScrollRef.current = false;
    serialRef.current += 1;
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (seeded.length > 0 || !category.hasMore) return;
    const target = sectionRef.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    let closed = false;
    const observer = new IntersectionObserver((entries) => {
      if (closed || !entries.some((entry) => entry.isIntersecting)) return;
      closed = true;
      observer.disconnect();
      if (ioStartedRef.current || fetchedRef.current || loadingRef.current) return;
      ioStartedRef.current = true;
      void ensureLoadedRef.current("prefetch");
    }, { root: null, rootMargin: "160px 0px", threshold: 0 });
    observer.observe(target);
    return () => {
      closed = true;
      observer.disconnect();
      if (!fetchedRef.current) ioStartedRef.current = false;
    };
  }, [category.hasMore, category.id, seeded.length]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const measure = () => {
      setAtStart(rail.scrollLeft <= 1);
      setAtEnd(rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(rail);
    const onScroll = () => {
      const atEndNow = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1;
      setAtStart(rail.scrollLeft <= 1);
      setAtEnd(atEndNow);
      if (focusRevealEnabledRef.current) scheduleFocusedCardReveal(rail);
      if (programmaticScrollRef.current) {
        endArmedRef.current = !atEndNow;
        return;
      }
      if (!atEndNow) {
        endArmedRef.current = true;
        return;
      }
      if (rail.scrollLeft <= 1 || !endArmedRef.current) return;
      if (visibleRef.current >= productsRef.current.length && fetchedRef.current) return;
      endArmedRef.current = false;
      void ensureLoadedRef.current("advance");
    };
    const listenTouch = typeof PointerEvent === "undefined";
    rail.addEventListener("scroll", onScroll, { passive: true });
    rail.addEventListener("wheel", releaseFocusedCardReveal, { passive: true });
    rail.addEventListener("pointerdown", releaseFocusedCardReveal, { passive: true });
    if (listenTouch) rail.addEventListener("touchstart", releaseFocusedCardReveal, { passive: true });
    return () => {
      cancelFocusedCardReveal();
      observer?.disconnect();
      rail.removeEventListener("scroll", onScroll);
      rail.removeEventListener("wheel", releaseFocusedCardReveal);
      rail.removeEventListener("pointerdown", releaseFocusedCardReveal);
      if (listenTouch) rail.removeEventListener("touchstart", releaseFocusedCardReveal);
    };
  }, [visibleCount, products.length]);

  function scrollOneCard(rail: HTMLUListElement) {
    const before = rail.scrollLeft;
    const token = ++programmaticTokenRef.current;
    programmaticScrollRef.current = true;
    scrollByCard(rail, 1);
    if (Math.abs(rail.scrollLeft - before) < 1) {
      if (programmaticTokenRef.current === token) programmaticScrollRef.current = false;
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (programmaticTokenRef.current === token) programmaticScrollRef.current = false;
      });
    });
  }

  useLayoutEffect(() => {
    if (!pendingNextScrollRef.current) return;
    const rail = railRef.current;
    if (!rail) {
      pendingNextScrollRef.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (!pendingNextScrollRef.current) return;
      if (!rail.isConnected) {
        pendingNextScrollRef.current = false;
        return;
      }
      pendingNextScrollRef.current = false;
      scrollOneCard(rail);
    });
    return () => cancelAnimationFrame(frame);
  }, [visibleCount, products]);

  function onRowFocus() {
    if (seeded.length > 0 || fetchedRef.current || loadingRef.current || ioStartedRef.current || phase === "error") return;
    ioStartedRef.current = true;
    void ensureLoaded("prefetch");
  }

  function onPrevious() {
    const rail = railRef.current;
    if (!rail || atStart || rail.scrollLeft <= 1) return;
    scrollByCard(rail, -1);
  }

  function onNext() {
    const rail = railRef.current;
    if (!rail) return;
    if (atEnd && fetchedRef.current && visibleRef.current >= productsRef.current.length) return;
    const atEndNow = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1;
    if (!atEndNow) {
      scrollOneCard(rail);
      return;
    }
    if (visibleRef.current >= productsRef.current.length && fetchedRef.current) return;
    if (pendingNextScrollRef.current) return;
    endArmedRef.current = false;
    pendingNextScrollRef.current = true;
    void ensureLoaded("advance");
  }

  const visible = products.slice(0, visibleCount);
  const canRevealMore = !fetched || visibleCount < products.length;
  const showLoader = canRevealMore && phase !== "error";
  const reserveSkeleton = visible.length === 0 && phase !== "ready";

  return (
    <section
      ref={sectionRef}
      className={styles.row}
      data-category-rail={category.id}
      aria-labelledby={headingId}
      aria-busy={phase === "loading"}
      onFocus={onRowFocus}
    >
      <div className={styles.headingRow}>
        <h3 id={headingId} className={styles.heading}>
          <Link href={collectionHref({ categoryId: category.id, sort })} prefetch={false}>
            <span dir="auto">{category.nameAr}</span>
          </Link>
        </h3>
        <div className={styles.controls}>
          <button type="button" className={styles.navButton} aria-controls={railId} aria-label={`Previous ${category.nameAr}`} aria-disabled={atStart} tabIndex={atStart ? -1 : 0} onClick={onPrevious}>Previous</button>
          <button type="button" className={styles.navButton} aria-controls={railId} aria-label={`Next ${category.nameAr}`} aria-disabled={atEnd && !canRevealMore} tabIndex={atEnd && !canRevealMore ? -1 : 0} onClick={onNext}>Next</button>
        </div>
      </div>
      <ul id={railId} ref={railRef} className={styles.track} role="list" onFocus={(event) => { focusRevealEnabledRef.current = true; scheduleFocusedCardReveal(event.currentTarget); }}>
        {visible.map((product) => (
          <li key={product.id} className={styles.item}>
            <ProductCard product={product} sizes={RAIL_IMAGE_SIZES} />
          </li>
        ))}
        {reserveSkeleton ? (
          <li className={styles.skeleton} aria-hidden="true">
            <span className={styles.skeletonMedia} />
            <span className={styles.skeletonCaption} />
          </li>
        ) : null}
      </ul>
      {phase === "loading" ? <p className={styles.status} role="status">Loading products</p> : null}
      {phase === "error" ? (
        <div className={styles.alert} role="alert">
          <p>Products could not be loaded.</p>
          <button type="button" className={styles.loadButton} aria-controls={railId} onClick={() => void ensureLoaded(visibleRef.current === 0 ? "prefetch" : "advance")}>Retry</button>
        </div>
      ) : null}
      {phase === "ready" && fetched && products.length === 0 ? <p className={styles.empty}>No products in this category.</p> : null}
      {showLoader ? (
        <button
          type="button"
          className={styles.loadButton}
          aria-controls={railId}
          onClick={() => void ensureLoaded(visibleCount === 0 ? "prefetch" : "advance")}
        >
          {visibleCount === 0 ? "Load products" : "Load more"}
        </button>
      ) : null}
    </section>
  );
}

function includeFocused(products: readonly PublicProductSummaryDto[], count: number): number {
  const active = document.activeElement;
  if (!(active instanceof HTMLAnchorElement)) return count;
  const id = active.dataset.productId;
  if (!id) return count;
  const index = products.findIndex((product) => product.id === id);
  return index >= count ? index + 1 : count;
}

function scrollByCard(rail: HTMLUListElement | null, direction: -1 | 1) {
  if (!rail) return;
  const item = rail.querySelector("li");
  const computed = getComputedStyle(rail);
  const gap = Number.parseFloat(computed.columnGap || computed.gap) || 0;
  const width = item instanceof HTMLElement ? item.getBoundingClientRect().width : rail.clientWidth;
  rail.scrollBy({ left: direction * (width + gap), behavior: "auto" });
}

function readSummaries(body: unknown, categoryId: string): PublicProductSummaryDto[] | null {
  if (!body || typeof body !== "object" || !("products" in body) || !Array.isArray((body as PublicCatalogBrowseDto).products)) return null;
  const products: PublicProductSummaryDto[] = [];
  for (const item of (body as PublicCatalogBrowseDto).products) {
    if (!isSummary(item)) return null;
    if (item.category.id !== categoryId) continue;
    products.push(item);
  }
  return products;
}

function isSummary(value: unknown): value is PublicProductSummaryDto {
  if (!value || typeof value !== "object") return false;
  const product = value as Partial<PublicProductSummaryDto>;
  const category = product.category;
  return typeof product.id === "string"
    && typeof product.nameAr === "string"
    && !!category
    && typeof category.id === "string"
    && typeof category.nameAr === "string"
    && (product.availability === "in_stock" || product.availability === "out_of_stock" || product.availability === "coming_soon")
    && (product.previewImageRef === null || typeof product.previewImageRef === "string")
    && (product.lowestSellingPricePiasters === null || (typeof product.lowestSellingPricePiasters === "number" && Number.isFinite(product.lowestSellingPricePiasters)));
}

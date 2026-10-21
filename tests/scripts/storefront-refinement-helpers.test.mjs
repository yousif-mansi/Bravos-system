import assert from "node:assert/strict";
import test from "node:test";
import {
  configuredPublicOrigin, informationPageMetadata, productPageMetadata, productStructuredData,
  publicAssetUrl, publicPageUrl, serializeJsonLd,
} from "../../apps/storefront/app/storefront-metadata.ts";
import { formatEgp, getPublicContacts, productMediaUrl } from "../../apps/storefront/app/public-catalog.ts";

const EMPTY_CONTACTS = {
  whatsappUrl: null,
  facebookUrl: null,
  instagramUrl: null,
  tiktokUrl: null,
};

test("information metadata uses the reviewed customer facts", () => {
  const shipping = informationPageMetadata("shipping");
  const returns = informationPageMetadata("returns");
  const contact = informationPageMetadata("contact");
  assert.equal(shipping.title, "Shipping");
  assert.equal(returns.title, "Returns");
  assert.equal(contact.title, "Contact");
  for (const description of [shipping.description, returns.description, contact.description]) {
    assert.equal(typeof description, "string");
    assert.doesNotMatch(description, /in-system|this page does not|none is configured|free shipping|delivery date/i);
  }
});

test("public origin controls canonical and share-image URLs without reading deployment env", () => {
  const product = pairProduct({
    id: "prod-share",
    imageRefs: ["looks/shirt 1.jpg"],
  });
  const mediaPath = productMediaUrl(product.imageRefs[0]);
  assert.match(mediaPath, /^\/api\/public\/catalog\/media\//);

  assert.equal(configuredPublicOrigin({ NODE_ENV: "production" }), null);
  assert.equal(configuredPublicOrigin({ NODE_ENV: "production", BRAVOS_PUBLIC_ORIGIN: "" }), null);
  assert.equal(publicPageUrl(`/products/${product.id}`, null), null);
  assert.equal(publicAssetUrl(mediaPath, null), null);
  const missing = productPageMetadata(product, null);
  assert.equal(missing.title, product.nameAr);
  assert.equal(typeof missing.description, "string");
  assert.equal(missing.alternates, undefined);
  assert.equal(Object.hasOwn(missing.openGraph, "url"), false);
  assert.equal(Object.hasOwn(missing.openGraph, "images"), false);
  assert.equal(missing.twitter.card, "summary");
  assert.equal(Object.hasOwn(missing.twitter, "images"), false);
  assert.doesNotMatch(JSON.stringify(missing), /https?:\/\//);
  const missingData = productStructuredData(product, null);
  assert.equal(missingData.name, product.nameAr);
  assert.equal(Object.hasOwn(missingData, "url"), false);
  assert.equal(Object.hasOwn(missingData, "image"), false);

  const origin = "https://shop.example";
  assert.equal(configuredPublicOrigin({ NODE_ENV: "production", BRAVOS_PUBLIC_ORIGIN: origin }), origin);
  const canonical = publicPageUrl(`/products/${product.id}`, origin);
  const image = publicAssetUrl(mediaPath, origin);
  assert.equal(canonical, `${origin}/products/${product.id}`);
  assert.equal(image, `${origin}${mediaPath}`);
  const published = productPageMetadata(product, origin);
  assert.equal(published.alternates.canonical, canonical);
  assert.equal(published.openGraph.url, canonical);
  assert.equal(published.openGraph.images[0].url, image);
  assert.deepEqual(published.twitter.images, [image]);
  assert.equal(published.twitter.card, "summary_large_image");
  const publishedData = productStructuredData(product, origin);
  assert.equal(publishedData.url, canonical);
  assert.equal(publishedData.image, image);

  for (const value of [
    "http://shop.example",
    "https://localhost",
    "https://127.0.0.1",
    "https://user:secret@shop.example",
    "https://shop.example/store",
    "https://shop.example/?q=1",
    "https://shop.example/#frag",
  ]) {
    const rejectedOrigin = configuredPublicOrigin({ NODE_ENV: "production", BRAVOS_PUBLIC_ORIGIN: value });
    assert.equal(rejectedOrigin, null, value);
    const rejected = productPageMetadata(product, rejectedOrigin);
    assert.equal(rejected.alternates, undefined, value);
    assert.equal(Object.hasOwn(rejected.openGraph, "url"), false, value);
    assert.equal(Object.hasOwn(rejected.openGraph, "images"), false, value);
  }
});

test("an orderable pair advertises its own price when a cheaper pair cannot be ordered", () => {
  const product = pairProduct({
    availability: "in_stock",
    orderable: true,
    variants: [pair("unavailable", 20_000, false), pair("orderable", 30_000, true)],
  });
  const description = productPageMetadata(product, null).description;
  assert.equal(typeof description, "string");
  assert.match(description, /In stock/);
  assert.match(description, pricePattern(30_000));
  assert.doesNotMatch(description, /From/);
  assert.equal(description.includes(formatEgp(20_000)), false);

  const offers = offersOf(product);
  assert.deepEqual(offers.map((offer) => [offer.price, offer.availability]), [
    ["200.00", "https://schema.org/OutOfStock"],
    ["300.00", "https://schema.org/InStock"],
  ]);
  assert.deepEqual(offers.map((offer) => offer.name), ["Unavailable / Pair", "Orderable / Pair"]);
  assertNoPrivateOfferFields(productStructuredData(product, null));
});

test("a fully out-of-stock product keeps informational prices and exact pair availability", () => {
  const product = pairProduct({
    nameAr: "Out shirt",
    descriptionAr: "",
    category: { id: "pants", nameAr: "Pants" },
    publication: "available",
    availability: "out_of_stock",
    orderable: false,
    variants: [pair("low", 20_000, false), pair("high", 30_000, false)],
  });
  const description = productPageMetadata(product, null).description;
  assert.match(description, /Out of stock/);
  assert.match(description, /From/);
  assert.match(description, pricePattern(20_000));
  assert.doesNotMatch(description, /In stock/);
  assert.deepEqual(offersOf(product).map((offer) => [offer.price, offer.availability]), [
    ["200.00", "https://schema.org/OutOfStock"],
    ["300.00", "https://schema.org/OutOfStock"],
  ]);
});

test("Coming Soon metadata has no selling price and no offers", () => {
  const product = pairProduct({
    nameAr: "Preview piece",
    descriptionAr: "",
    category: { id: "preview", nameAr: "Outerwear" },
    publication: "coming_soon",
    availability: "coming_soon",
    orderable: false,
    variants: [pair("preview", 45_000, false)],
  });
  const description = productPageMetadata(product, null).description;
  assert.match(description, /Coming soon/);
  assert.equal(description.includes(formatEgp(45_000)), false);
  assert.doesNotMatch(description, /From/);
  const data = productStructuredData(product, null);
  assert.equal(Object.hasOwn(data, "offers"), false);
});

test("product text that contains a script closer cannot break out of JSON-LD", () => {
  const product = pairProduct({
    nameAr: "Name </script>",
    descriptionAr: "Break </script><script>alert(1)</script> & more",
    variants: [pair("orderable", 30_000, true)],
  });
  const serialized = serializeJsonLd(productStructuredData(product, null));
  const html = `<script type="application/ld+json">${serialized}</script>`;
  const closer = html.indexOf("</script>");
  assert.equal(closer, html.length - "</script>".length);
  assert.doesNotMatch(serialized, /<\/script>|<script|&(?!#?\w+;)/i);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.name, product.nameAr);
  assert.equal(parsed.description, product.descriptionAr);
  assert.equal(parsed.offers[0].availability, "https://schema.org/InStock");
  assert.equal(parsed.offers[0].price, "300.00");
});

test("optional contact read is bounded and falls back without throwing", { timeout: 20_000 }, async () => {
  const original = globalThis.fetch;
  try {
    const refused = await withFetch(
      () => response(503, { ignored: true }),
      () => getPublicContacts(),
    );
    assert.deepEqual(refused.result, EMPTY_CONTACTS);
    assert.equal(refused.calls.length, 1);
    assert.match(String(refused.calls[0].url), /\/api\/public\/storefront\/contacts$/);
    assert.equal(refused.calls[0].cache, "no-store");
    assert.ok(refused.calls[0].signal);

    const invalid = await withFetch(
      () => response(200, { whatsappUrl: 12, facebookUrl: null, instagramUrl: null, tiktokUrl: null }),
      () => getPublicContacts(),
    );
    assert.deepEqual(invalid.result, EMPTY_CONTACTS);

    const published = await withFetch(
      () => response(200, {
        whatsappUrl: "https://wa.me/201000000018",
        facebookUrl: null,
        instagramUrl: "",
        tiktokUrl: null,
      }),
      () => getPublicContacts(),
    );
    assert.deepEqual(published.result, {
      whatsappUrl: "https://wa.me/201000000018",
      facebookUrl: null,
      instagramUrl: "",
      tiktokUrl: null,
    });

    const started = Date.now();
    const hung = await withFetch(
      (_url, init) => new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        const fail = () => reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        if (signal.aborted) fail();
        else signal.addEventListener("abort", fail, { once: true });
      }),
      () => Promise.race([
        getPublicContacts(),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("contact read exceeded 15s")), 15_000)),
      ]),
    );
    const elapsed = Date.now() - started;
    assert.deepEqual(hung.result, EMPTY_CONTACTS);
    assert.equal(hung.calls.length, 1);
    assert.equal(hung.calls[0].signal?.aborted, true);
    assert.equal(hung.calls[0].signal?.reason?.name, "TimeoutError");
    assert.ok(elapsed >= 9_000 && elapsed < 13_000, `contact stall elapsed ${elapsed}ms`);
  } finally {
    globalThis.fetch = original;
  }
});

function pair(name, sellingPricePiasters, orderable) {
  return {
    id: `variant-${name}`,
    size: { id: `size-${name}`, nameAr: "Pair" },
    color: { id: `color-${name}`, nameAr: name === "unavailable" ? "Unavailable" : name === "orderable" ? "Orderable" : name === "low" ? "Low" : name === "high" ? "High" : "Preview" },
    sellingPricePiasters,
    availableQuantity: orderable ? 1 : 0,
    orderable,
  };
}

function pairProduct(overrides) {
  return {
    id: "prod-price",
    nameAr: "A pair with two prices",
    descriptionAr: "A pair with two prices",
    category: { id: "shirts", nameAr: "Shirts" },
    publication: "available",
    availability: "in_stock",
    orderable: true,
    imageRefs: [],
    sizeGuideAr: null,
    variants: [],
    ...overrides,
  };
}

function offersOf(product) {
  const offers = productStructuredData(product, null).offers;
  assert.ok(Array.isArray(offers));
  return offers;
}

function pricePattern(piasters) {
  return new RegExp(formatEgp(piasters).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

function assertNoPrivateOfferFields(data) {
  const names = [];
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        names.push(key);
        visit(nested);
      }
    }
  };
  visit(data);
  assert.equal(names.some((key) => /cost|profit|rating|gtin|sku|batch/i.test(key)), false);
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function withFetch(responder, run) {
  const calls = [];
  globalThis.fetch = (url, init) => {
    calls.push({ url, cache: init?.cache, signal: init?.signal });
    return Promise.resolve(responder(url, init));
  };
  const result = await run();
  return { calls, result };
}

# SF-00 / SF-01 delivery review

**Date:** 23 September 2026. **Baseline:** `main` at `15fd366`. **Delivery status:** Final visual review complete; user authorized commit after typography and preview-hygiene checks.  
**Scope:** Approved roadmap finalization, SF-00 readiness specification and SF-01 storefront foundation only. SF-02 onward has not started.

## Product result

The approved roadmap now contains SF-00–SF-12 and is published as GitHub issues #30–#42. SF-00 is complete: [content readiness](../planning/storefront-content-readiness.md) defines hero/product inputs, ratios/crops, placeholder rules, copy sources and missing inputs. Optional campaign/editorial content renders nothing when absent; commerce and purchase confidence have priority.

SF-01 introduces storefront-local bone/ink tokens, spacing and control states; extracts the existing server header/footer; applies local Amiri Regular to editorial headings while retaining Cairo for commerce; and makes shell links/focus more usable. Official logo assets are reused, including a readable horizontal footer logo. The old gradient is replaced by a flat surface pending SF-03's real photography. Existing text and catalog records are unchanged.

This is a foundation, not the completed storefront transformation. The ordinary integration preview retains its unrelated test artwork and missing-image product because business data was not changed. A separate labeled design-review preview at `http://127.0.0.1:3020/?font=amiri` uses neutral image space and no catalog access. See [final typography and preview review](storefront-typography-review.md). No fake campaign, product, chapter or price was added to the application/catalog.

## Application files

| File | Change / reason |
| --- | --- |
| `apps/storefront/app/layout.tsx` | Server header/footer composition and generated Cairo font variable; provider, analytics, contacts, language, metadata and skip link retained |
| `apps/storefront/app/globals.css` | Foundation token consumption, editorial/commerce type roles, flat hero surface, shared control states, 44px shell/breadcrumb targets and footer sizing |
| `apps/storefront/app/styles/tokens.css` | Storefront-only semantic colors/spacing, compatibility aliases and local Amiri face |
| `apps/storefront/app/components/store-header.tsx` | Existing public navigation and CartLink extracted without moving cart state |
| `apps/storefront/app/components/store-footer.tsx` | Existing configured contacts and factual copy extracted; official horizontal logo rendered legibly |
| `apps/storefront/public/fonts/` | One 108,560-byte Arabic Amiri WOFF2, its license and source/hash documentation; no runtime package dependency |

Planning changes are the final roadmap, thirteen ticket documents and content-readiness report. Existing unrelated working-tree changes remain untouched. No API, database, route, permission, internal-app or business-rule files were changed. Cart provider/types, public catalog reads, Next media-cache configuration and checkout quote/submission/recovery logic are unchanged.

## Evidence

- Pre-edit isolated production build at `15fd366`: `.scratch/storefront-foundation/baseline/README.md`, fixture/lockfile hashes, twelve screenshots and LCP/CLS/resource measurements. The live preview was not replaced. These measurements use the small existing fixture and unthrottled local network, not representative launch performance.
- Pinned Node 22.13.1 / pnpm 10.34.5 typecheck and architecture checks passed. The isolated storefront production build passed after the final shell change. Application-source diff checks passed; the pre-existing protected review file hash remained unchanged. When staging the previously untracked documentation/license, Git also reports intentional Markdown hard breaks and upstream license trailing whitespace; those source-format details are preserved rather than changing approved prose or the licensed file/hash.
- Independent source review found hover/disabled contrast and dark-summary focus issues; those were corrected and the reviewer confirmed the fixes. Providers, analytics and public behavior remain intact.
- Active-preview Chromium: home/product/empty-cart/empty-checkout at 390, 768 and 1440px all returned HTTP 200 without page/console or HTTP errors. No horizontal overflow at those widths or 320px. Font failure retained readable Cairo fallback; reduced motion and first-Tab skip link worked.
- Final targeted visual recapture confirmed a legible 140×59px footer logo and 44×44px breadcrumb. Main agent reviewed the actual phone/desktop foundation screenshots. Evidence: `.scratch/storefront-foundation/verification/README.md` and `screenshots/*-final.png`.
- CSS 200% zoom was checked as an approximation; this is not a claim of physical-device/native browser-zoom certification. Real iOS/Android remains a later quality/release check.

## Known test and release limitations

The focused storefront/checkout browser run finished **6 passed, 1 failed**. The failure is an existing strict-locator ambiguity at `tests/browser/checkout.spec.ts:244`: `getByText(/CLOSED-ORDERING-E2E-28/)` matches both a product heading and variant text. The same failure was reproduced on clean baseline `15fd366`, after the cart URL and retained count assertions passed. No test was deleted, weakened or changed to hide it. Final run details are in `.scratch/storefront-foundation/sf01-verification-report.md`; the reviewable source patch, including new text files, is `.scratch/storefront-foundation/sf01-source.diff`.

The baseline records 390px empty-cart CLS of 0.122. The initial foundation's larger footer made hydration movement worse; tracing identified only the footer as the source. A shared-shell min-height/flex adjustment stabilized it without touching route logic. The final narrow production trace found no layout-shift entries for cart/checkout at 390px, and 0.0046 for cart at 320px. JavaScript transfer totals matched the baseline on all four routes. These are local diagnostic results, not representative SF-11 performance acceptance. Evidence: `.scratch/storefront-foundation/sf01-verification/visual/shifts.json` and `checks.json`.

Real garment/hero photography, optional factual chapter copy and configured business delivery areas remain explicit readiness inputs. There are no empty storytelling modules.

## Review boundary

SF-01 final review is complete and the user authorized commit after the requested comparison and preview checks. The test suite is not silently represented as entirely green: retain the documented baseline failure. Source diff and changed-file allowlist were reviewed before commit. Do not start SF-02 as part of this work cycle.

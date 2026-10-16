# Storefront category browsing review — 16 October 2026

Implementation and engineering review are complete. Full-page visual review is substantially covered, but its final acceptance remains pending the specific supplemental captures below. This document does not approve that incomplete gate.

## Delivered scope

- Homepage category rows replace Selected pieces and the duplicated all-products grid. Focused category URLs retain their complete collection grid and the `#catalog-title` recovery destination.
- Initial server rendering includes only the first category's first four summaries at most. Lower rows load near the viewport or through explicit controls; additional cards mount in batches of four. Category/product link prefetching is disabled.
- Public search UI, URL handling, styling, application filtering and query input are removed. Staff replacement-item search retains name/description/category matching using the existing public detail endpoint.
- Sorting is Default order and both price directions. Zero prices, missing prices last, stable ties and starting-price wording are preserved. Customer-facing catalog totals are removed.
- Card titles are centered, retaining automatic text direction. All card media uses rounded 4:5 cover frames with zero image padding/margin; price and availability share one row.
- Rows provide native scrolling, Previous/Next, loading, error/Retry and explicit load controls. Disabled boundary controls preserve existing keyboard focus. Focus correction yields to wheel/pointer input and resumes on a new keyboard focus entry.
- The official image-only hero, fonts, dark identity, public publication states, cart, checkout, ordering, stock, recovery, permissions and API response shapes remain intact. No dependencies, schema changes or merchandise mutations were introduced.

## Verification record

All commands used the pinned Windows Node 22.23.3 runtime, serial browser workers and zero automatic retries.

| Gate | Recorded result | Evidence under `.scratch/` |
|---|---|---|
| Public browse, price sorting, staff replacement lookup | 3 files, 9 tests passed | `category-storefront-20261016/verification/http-20261016-055901/` |
| Workspace typecheck, architecture, storefront build | Passed | `category-storefront-20261016/verification/static-20261016-060116-526/` |
| Initial affected browser run | 6 passed, 6 failed | `category-storefront-20261016/verification/affected-20261016-060306-950/` |
| Six repaired scenarios | Separate 6/6 pass; not a fresh 12-case run | `category-storefront-20261016/verification/repaired-20261016-061612-863/` |
| Extended touch/wheel/keyboard first attempt | Failed setup scroll assertion; Windows teardown probe also timed out | `category-storefront-20261016/verification/focus-20261016-104740-158/` |
| Extended touch/wheel/keyboard after setup repair | 1/1 passed; clean teardown | `category-storefront-20261016/verification/focus-20261016-105236-205/` |
| Final storefront typecheck/build | Passed after the final application fix | `taste-review-20261015/verification/static-20261016-104651/` |
| Four-width development visual capture | 397 screenshots, including 369 real viewport captures; exited 1 with nine recorded capture/coverage failures | `category-storefront-20261016/verification/captures-2026-10-16T10-54-42-349Z-3b717e86/` |

The initial browser failures exposed one application defect (native-disabled Next lost focus) and five test assumptions. Repairs retained business, focus, visibility and stock assertions: automatic-loader races, native click scrolling before dialog activation, dynamically growing Tab traversal, compounded anchor spacing, and waiting for committed sort navigation. The extended test now waits for existing document scrolling to settle, checks meaningful stable wheel movement while focus remains, and checks touch-to-keyboard entry without resetting the swipe position.

Visual inspection subsequently exposed genuine first-card outline clipping after touch. The scroll/focus correction was repaired, independently reviewed, and covered by the extended regression. Earlier failed/partial captures remain available; they were not replaced by successful evidence.

## Browser workload evidence

The unchanged ordinary preview has 32 products in 6 categories. Raw homepage HTML had 36 product anchors before this pass (four selected plus the full catalog), compared with 1 after category browsing was introduced. The first category currently contains one product; the implementation cap is four.

This establishes reduced initial server-rendered cards and serialized product summaries. It does not establish production performance, responsive-image byte savings or reduced database work. The existing public catalog reader still reads published products/availability before category filtering; a category response is not paginated. Availability is not stored in a shared or persistent browser cache.

## Visual evidence and acceptance

Final capture directory:

`.scratch/category-storefront-20261016/verification/captures-2026-10-16T10-54-42-349Z-3b717e86/`

The harness scrolls overlapping real viewports before supplementary full-page captures and attempts every horizontal product, focused collections, sorting, PDP, bag, checkout presentation, information pages and loading/error/retry. API writes, including analytics, quote and order submission, are blocked. Review records list actually inspected filenames; attempted captures are not counted as successful coverage.

- All home vertical tiles were inspected at 320, 390, 768 and 1440px, before and after row traversal. Main personally inspected the complete 390/1440 sequences; the independent reviewer inspected 320/768 at readable resolution.
- The repaired 320px first and last jacket focus screenshots show complete cards and outlines. Horizontal rows and focused collections show consistent portrait media, centered titles and aligned price/status rows.
- The capture completed 24 category-row checks: 21 have full forward coverage. Three 768px rows have gaps in their forward screenshot sequence because prior native keyboard traversal had already scrolled later rows. Focused collection images show the missing products, but do not replace the missing horizontal-state evidence.
- The nine failures comprise two mobile category-anchor selectors targeting the intentionally hidden desktop link, four incorrectly scoped PDP label selectors, and those three tablet coverage gaps. No application defect is established by these failures. The corrected supplemental harness is prepared separately; original evidence is preserved.
- Main personally inspected the isolated 390px loading/error/Retry/recovered screenshots. The request interception returned a browser-context-only 503, then real products recovered successfully.
- No page JavaScript errors, failed media/font assets, unexpected API writes or source changes were recorded. Intentional blocked analytics requests produced the recorded blocked-client console errors; development CSS preload warnings are retained in the manifest.
- Independent review records list 182 opened 320/768px images, 156 opened 390/1440px images, and 91 desktop/tablet collection images; these sets overlap and must not be added together as a unique screenshot total. Main's separate record covers the full 390/1440 home sequences and the isolated recovery states. The 1440px home-sort snapshots stop above the sort control; selected values are visible in the collection-sort captures, so those home snapshots alone do not prove their selected value.
- Development screenshots include the Next.js development badge. Existing legacy Arabic merchandise/category names remain as stored; public navigation is English/LTR and Arabic names use the supplied Arabic face.

### Verification still blocked by local resources

After the capture browser exited, Windows reported approximately 3,928 MB free physical memory and 3,674 MB free virtual memory. The existing verification guard requires at least 3,000 MB physical and 4,000 MB virtual memory. It was not weakened, and user applications were not closed. As instructed, source/image review continued while the blocked verification was identified.

The prepared ignored `capture-supplement.mjs` needs to run once the guard passes. It covers only the missing work:

1. Mobile category-anchor, collection, sorting and invalid/stale-category recovery at 320/390px, using the visible mobile recovery link.
2. Three incomplete 768px horizontal rows, using native Previous/Next pointer controls to capture their actual start-to-end contents.
3. Selected-variant PDP, populated bag/drawer, checkout presentation, Shipping, Returns, Contact and missing-page views at all four widths, using each variant input's actual wrapping label.

No additional application change is proposed. The isolated retry sequence already passed and need not be repeated. The selected-variant workflow verifies browser-local cart IDs/prices and never submits an order or modifies stock. Until these captures and their readable image reviews are complete, final full-site visual approval remains pending.

## Change control

The per-pass patch and file inventory are in `.scratch/category-storefront-20261016/review/`; they compare the saved working-tree baseline rather than including unrelated earlier work. The scope is 25 source files and 12 focused test files, plus the separate instructions/planning/review documents. Existing unrelated dirty files remain outside that patch. `git diff --check` passed; the index is empty.

No staging, commit, push, deployment, catalog mutation or business-rule change was performed. The protected review file remains SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

Final ordinary-preview health checks returned HTTP200 for `http://127.0.0.1:3000/` and `http://127.0.0.1:3010/api/public/health`. The running working tree remains on `codex/ux-purchase-guidance` at `acb2edc`, with the reviewed uncommitted changes. The staff application was not started as part of this final memory-constrained capture cycle.

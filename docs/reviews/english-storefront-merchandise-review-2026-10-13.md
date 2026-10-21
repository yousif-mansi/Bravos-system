# English storefront and desktop merchandise review — 13 October 2026

This pass completes the owner-authorized English sample-store preview and desktop product/category organization. It is local engineering and visual evidence, not a production launch approval. Nothing in this pass is staged, committed, pushed, or deployed.

## Delivered scope

- Public storefront uses English/LTR navigation, accessibility labels, customer help, errors, bag, checkout, and EGP formatting. Existing DTO/storage fields and routes remain unchanged; staff stays Arabic.
- Clash Display uses the owner's unchanged variable WOFF2 and supplied FFL license. The previous English display face is no longer selected; Arabic fallback is retained without mandatory preload. No runtime third-party font service.
- The opening hero is the official cover image alone, with an accessible hidden title. The owner's future landing image has not yet arrived; its purpose and crop must be reviewed before replacement.
- Dark Bravos surfaces, official branding, separated category discovery, varied product-wall sizes, bounded hover/reveal motion, and ordering confidence remain coherent. No invented campaigns, reviews, contacts, fabric certifications, or delivery times.
- Products and receiving/intake have desktop-only category hierarchy, name/SKU filtering, match counts, clear/no-match feedback, and preserved selected IDs/drafts/frozen operations. Products filters now appear in the first desktop row; taxonomy maintenance follows below. Staff shell, POS, and mobile organization remain intact.
- Mobile checkout has separate item count, preliminary-total label, and amount rather than the cramped bold line found during visual review.
- Windows CI runner changes are prepared; no Linux execution occurred during this pass. Hosted execution of the uncommitted workflow is still pending. CI now includes the new pure intake guards without accessing business data.

## Authorized local sample merchandise

The manifest and image provenance are in assets/sample-catalog. Thirty fictional sample products were added through existing manager catalog, receiving, and media APIs: 8 Pants, 6 Jackets, 8 Shirts, and 8 T-Shirts. Four explicit sizes and one image-matching color each produce 120 variants. Five units of every variant were received into each of Abshway and Fayoum, totaling 1,200 sample units.

The ordinary development database previously had two public products; both and their stock/history were preserved. There are consequently 32 public products, including two legacy Arabic records. English presentation does not translate or overwrite retained business facts. The new 30-item range is English. No ordinary sale or order was created during intake or visual captures, and delivery configuration was unchanged.

Stable receipt operations, persisted immutable payloads, upload fingerprints/checkpoints, revision guards, and a pre-mutation snapshot make the intake resumable without refilling sold units. Baseline/checkpoints and credentials stay ignored under .local. Public reads were checked for restricted cost fields.

All 30 generated portrait images retain their framing and 1122×1402 dimensions. Existing Sharp encoded WebP delivery copies at quality82/effort6: 62,865,843 original PNG bytes became 2,043,708 WebP bytes, a 97% reduction. Reviewed WebPs are intended versioned assets; original PNG masters stay local/ignored. Provenance includes prompts, sources, dimensions, encoding, and hashes.

## Main review corrections

1. Saved/replayed checkout acknowledgment does not assert the current order is pending or promise future confirmation from a frozen submission snapshot. It states the request was already received, not sent twice, and that this receipt does not establish current status. Fresh acknowledgment retains its truthful pending/not-reserved wording.
2. Enter in desktop intake/receiving search does not implicitly submit its owning business form. Explicit submit/retry behavior and frozen IDs remain.
3. A resumed upload cannot overwrite a manager-chosen image; the script guards image references again on the fresh read immediately before publication.
4. Mobile checkout summary spacing and desktop browse placement were corrected from actual screenshots.
5. Test migration restored Arabic staff selectors, exact ambiguous names, real Next-generated font filenames, input-vs-option assertions, and hydration-aware readiness. Business/recovery assertions were retained.

Grok implemented source lanes A–F and bounded corrections. Sol 6.1 read-only reviews and visual captures informed main's decisions. Main reviewed diffs, supplied images/content, executed intake and gates, added the small CI guard step, corrected the pure-test loader documentation, and removed one extra EOF blank line. No backend feature, database, contract, permission, stock, order, or recovery-policy change was made.

## Recorded verification

| Gate | Actual result / limits |
| --- | --- |
| Initial workspace typecheck | Pass, exit0 |
| Architecture checks | Pass, exit0 |
| Internal and storefront compile-only builds | Both pass, exit0; no production startup attempted |
| Pure intake tests, strip-only loader | Harness failure before assertions: TypeScript parameter property unsupported; original failure retained |
| Pure intake tests with existing tsx loader | 14 passed, exit0 |
| Intake plan | 30 ready images, exit0 |
| Ordinary local apply | 30 products checkpointed, exit0 |
| Separate read-only intake verify | 30 public sample products, explicit pairs, media, receipts, and preserved manager data verified, exit0 |
| Focused browser run, Windows | 8 passed, 5 failed; original log retained |
| First focused failed-case rerun | 3 passed, 2 failed; separate log retained |
| Remaining two cases | 2 passed in 30.5 seconds, exit0; navigation trace retained |
| Final compile/type checks after polish | Workspace typecheck and both app compile-only builds pass, all exit0; original and final logs retained separately |

Do not describe these separate browser runs as a fresh clean 13-case pass. All 13 selected cases now have passing evidence across 8 + 3 + 2 passing results; the failed runs are retained. Failure details: original stale staff copy, ambiguous Bag heading, option-toHaveValue, original font filename, and transient Next streaming sort markup; first rerun exposed an ambiguous Arabic product label and a rapid two-navigation test step. The final navigation test asserts the bag URL, visible bag heading/summary, and exact checkout href before clicking, then asserts the checkout URL. Its trace and HTTP log show /cart followed by /checkout, both200, and the original order/coupon/discount/cart-recovery assertions passed. No app navigation code was changed; this proves the stabilized tested path, without claiming every possible rapid-click interaction was investigated.

Twenty route/viewport checks in the passing font/media case covered home, collection, product, bag, and checkout at320/390/768/1440. Maximum observed development CLS was0.015340858391440275, with no overflow or runtime errors. This is development Chromium evidence, not production-network LCP/INP or physical-device acceptance.

## Visual evidence and local review

Ignored evidence root: .scratch/english-fashion-20261013/.
- Initial visual capture: 42 screenshots, runtime-report.json, duplicate-and-focused-report.json.
- Polished focused capture: 8 screenshots and report.json under visual/polished/.
- Main opened actual home1440/390, product001mobile, product009desktop, bag390, checkout390 before/after, and Products1440 before/after.
- Polished checkout320/390 geometry confirms no count/label/amount overlap and no horizontal overflow. Products1440 filters are visible without scrolling; category8/32, name1/32, SKU1/32.
- Final captures had no page errors or broken images. Initial unauthenticated staff workspace401 was expected; Next development badge and two unused CSS-preload warnings are development artifacts.
- Settled hydration diagnostics show one visible/total sort and quantity control at both widths; transient streaming markup is not persistent duplicate visible UI.

Current running development URLs:
- Store: http://127.0.0.1:3000/
- Staff: http://127.0.0.1:5173/
- API health: http://127.0.0.1:3010/api/public/health

These serve the current working tree on codex/ux-purchase-guidance, based on merged main acb2edc9f9e35ef6d3aa6b0f983785519dca8bee, plus uncommitted reviewed changes. They do not represent a new published GitHub commit.

## Remaining review / release work

- Owner reviews the actual English store, Clash scale, new sample photography, category organization, and upcoming landing image. Visual/product acceptance remains separate from logic implementation.
- Publish this checkpoint only after explicit commit approval; run hosted Windows CI for the resulting exact commit. No issue is closed by local evidence.
- The two legacy Arabic catalog records remain preserved. Replacing or retiring them is a separate explicit catalog presentation decision; no silent deletion or stock reassignment.
- Hosting/domain/TLS/proxy/monitoring, permitted production measurements, physical iPhone/iPad/Android/Windows operator testing, external recovery/rollback drill, and operational pilot remain release-execution gates. Sample content no longer blocks completion of a hosted preview.
- Earlier production startup approval-review rejection remains separate: execution was blocked before start, exact policy trigger unknown. This pass does not retry or bypass it and does not call it an application runtime failure.
- No optional empty factual chapters/storytelling sections were invented to declare roadmap completion.

The protected review file remains SHA2563361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A. Existing unrelated local fonts, outputs, stores, and private files remain untouched. Index is empty.

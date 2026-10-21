# Bravos storefront experience audit — 14 October 2026

## Review outcome

The requested storefront transformation is implemented locally by Grok and reviewed by the main agent. It is ready for owner visual review. This is **not production or launch approval**. At the owner's request, further testing is stopped and a clean final two-case browser run remains pending.

The run already in progress when that request arrived verified the bag preview, but its homepage case failed. No commit, push, merge, deployment, issue closure, or catalog/stock/order/sale/configuration change was made during this pass. Routine browsing can generate existing aggregate analytics events. The index is empty. The working branch remains `codex/ux-purchase-guidance`, based on `acb2edc9f9e35ef6d3aa6b0f983785519dca8bee`.

## Implemented experience

| Area | Result |
| --- | --- |
| Brand and typography | English/LTR storefront with local Clash Display; Rose Regular/Medium/Bold registered for Arabic. Chromium confirmed actual Rose Medium Arabic glyph use and Clash English glyph use. Staff typography remains unchanged. |
| Opening and navigation | Official cover remains an image-only, edge-to-edge hero. Full-width sticky glass header, active navigation, responsive logo and controls; no visible hero headline or fabricated campaign. |
| Atmosphere and motion | Restrained olive/champagne ambient layers, a bounded desktop pointer spotlight, finite hero entrance, pauseable kinetic ticker, card hover/focus lighting, drawer entrance, and loading reserves. Reduced-motion behavior is supported. |
| Discovery | Real photographed, in-stock selected pieces appear before categories. The horizontal rail uses existing public catalog data and introduces no popularity, seasonal, discount, or bestseller claims. Sparse selections are omitted. |
| Product wall | Uniform 3:4 rounded media frames, studio radial lighting and inner borders, contained undistorted photos, two-line title space with full accessible text, aligned price/status rows, green In Stock and red Out of Stock. |
| Purchase confidence | Refined PDP surfaces and sticky-rail fit measurement; factual COD/WhatsApp guidance. The new bag preview reads the existing cart, labels saved merchandise estimates, and leads through the normal bag review. No shortcut bypasses authoritative checkout review. |

The generated Clash fallback initially intercepted Arabic before Rose. Grok corrected that configuration; local font requests and Chromium platform-font evidence verify the result. A native dialog Tab boundary initially moved focus to BODY. Grok added a scoped Tab/Shift+Tab wrap; empty and populated dialog traces now retain focus, Escape restoration, and scroll position.

## Scope and preserved systems

Application edits are confined to storefront shell/tokens/fonts; header/footer; home introduction, ambient scene, ticker and featured selection; cards/media/wall; bag-link/preview; and PDP presentation/sticky measurement. Browser coverage changes cover these surfaces, catalog anchors, and deterministic guest-checkout screenshots.

Backend, contracts, database migrations, dependency versions/lockfile, permissions, stock deductions, order submission, quote/recovery, and purchase handlers were not changed. Earlier staff categorization and CI work is preserved. The ordinary catalog remains 32 products, including the previously authorized 30 samples; checked pants/jacket variants still show five available units each and unchanged prices. No new catalog content was inserted in this pass.

Protected review SHA256 remains `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

## Verification and evidence

All commands used the pinned Windows Node 22.23.3 and pnpm 10.34.5. No Linux work or production storefront startup was performed.

| Gate | Recorded result |
| --- | --- |
| Workspace typecheck and architecture | Passed. |
| Storefront compilation | Passed; final focus correction also passed storefront typecheck/build with wrapper exit 0. Compilation does not establish production runtime readiness. |
| Initial focused browser run | **6 passed, 3 failed**: two oversized new fixtures and a checkout screenshot timeout. |
| Three-case rerun | **1 passed, 2 failed**: checkout passed; hero measurement sampled entrance motion, and bag Tab focus reached BODY. |
| Two subsequent startup attempts | **No tests executed**: isolated Windows Vite process failure, then a missing-module resolution error. Logs retained. |
| Run after memory recovered | **1 passed, 1 failed**: corrected bag preview passed; homepage encountered two `#home-title` elements during loading. |
| Final clean two-case run | **Pending, per owner instruction.** Do not describe these records as a fresh 9/9 pass. |

Manual development captures at 320/390/768/1440 showed full-width header/hero, no horizontal overflow or broken images, uniform 3:4 card media, zero same-row media-height spread, and price/status center differences below 0.008px. Core desktop/mobile home, catalog, PDP, bag preview, and checkout images were visually inspected. Quantity repair focuses an unobscured input below the mobile header. No ordinary orders or quotes were submitted during capture.

Windows Event 2004 confirmed memory exhaustion during startup failures: committed memory reached 99.44%. The dependency file/junction subsequently proved readable and lockfile-consistent; no reinstall was performed. The specific transient missing-module cause is unproven. Memory later recovered sufficiently for the last run. No unrelated application or ordinary development process was stopped.

A copied intermediate static wrapper expected one command despite executing three and returned 1; all three command exits were 0. That harness discrepancy is retained separately. The original static run and final focus verification wrappers exited 0.

Local evidence: `.scratch/flagship-20261014/main/` contains separate command logs/results, resource evidence, and integrity checks; `.scratch/flagship-20261014/visual/` contains screenshots, geometry summaries, actual font evidence, checkout diagnostics, and before/after focus traces. Original failed records were preserved beside follow-ups. Development badges/CSS preload warnings are not production evidence.

## Commerce audit and next priorities

Existing source supports public variant availability, whole-basket single-branch validation, persistent cart, authoritative delivery/discount quotes, guest COD submission, readable references, saved acknowledgment and duplicate-safe recovery. Staff confirmation recognizes sales and deducts stock; cancellation/failed-delivery reversals remain intact. These were preserved, not reimplemented.

| Priority | Remaining work and acceptance |
| --- | --- |
| High — verification | Resolve the homepage duplicate-element observation, distinguishing transient hidden streaming content from a persistent DOM defect. Preserve the unique hero/accessible heading requirements; then obtain the clean bounded two-case pass on Windows with adequate memory. No arbitrary `.first()`, removed assertion, or inflated tolerance. |
| High — release | Verify permitted production startup/performance, hosted CI for the accepted checkpoint, Windows operator/offline pilot, relevant physical-device/accessibility checks, hosting/TLS/proxy/monitoring, and external backup/recovery/rollback rehearsal. These need external environment or operational evidence. |
| Medium — customer information | Public contact links are configurable; dedicated customer shipping/returns/privacy/terms pages are absent. Publish confirmed facts and appropriate owner-provided policy content without inventing business rules. |
| Medium — discovery and SEO | Root metadata exists; product-specific metadata, canonical/OG/structured data, sitemap and robots coverage remain absent. Plan a bounded follow-up using real public data and the chosen public origin. |
| Low — optional experience | Richer curated collections, second-image interactions, wishlist or automated customer notifications/tracking are future scope. Manual WhatsApp confirmation is the approved current flow, not a defect. |

No new animation dependency was added. Media loading rules and image dimensions are preserved; spotlight updates are coalesced and do not trigger React state each frame. Actual production CLS, loading speed and device frame rate remain unmeasured.

Proceed with local visual review and the bounded verification follow-up. User-authorized sample content is available for that review; replacing it with real catalog content is not a prerequisite for preparing a hosted preview. Production publication still requires its own explicit approval and release evidence.

Local review URLs: storefront `http://127.0.0.1:3000/`, staff `http://127.0.0.1:5173/`, API health `http://127.0.0.1:3010/api/public/health`.

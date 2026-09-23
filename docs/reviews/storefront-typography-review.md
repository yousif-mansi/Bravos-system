# SF-01 final typography and preview review

**Date:** 23 September 2026. **Decision owner:** Main engineering/product agent.  
**User direction:** Compare Arabic editorial typography, remove unrelated artwork from the design-review path without changing business data, confirm shell/mobile behavior, then commit SF-01. Do not start SF-02.

## Visual comparison and decision

Three candidates were rendered against the same current storefront shell, same Arabic heading samples and unchanged Cairo commerce/body text. Desktop comparison uses three columns; phone comparison stacks the same specimens. These assessments are visual judgments, not font-performance or conversion claims.

| Criterion | Amiri Regular | Noto Naskh Arabic Regular | Cairo heading reference |
| --- | --- | --- | --- |
| Luxury menswear character | Strongest editorial contrast; expressive, confident calligraphic shape for short lead statements | Refined and calm, but reads more like book typography and provides less distinctive brand contrast | Clean and contemporary, but gives brand headings the same operational voice as commerce |
| Readability | Clear at current display sizes with 1.45 line height; keep headlines brief and avoid dense descriptions | Clear, even rhythm and restrained forms | Clearest for compact labels and dense/mixed text |
| Product-title compatibility | Works beside Cairo product titles; do not spread the editorial face into long names/variants/prices | Also compatible beside Cairo, with less typographic distinction | Retained for actual product titles, short/medium/multiline specimens, prices and controls |
| Mobile rendering | Readable at 390px and 320px; no overflow; readable Cairo fallback if font fails | Readable at 390px without overflow | Readable without overflow; retained for commerce/body throughout |

**Decision:** Retain the current Amiri Regular editorial face for home lead/browse headings. Do not change Cairo commerce/body or product-title usage. Do not add the comparison's Noto font to production. The main agent inspected desktop and mobile screenshots; no application typography change was necessary after comparison.

## Clean design-review path

Local evaluation URL: `http://127.0.0.1:3020/?font=amiri`. Switches also show `?font=cairo` and `?font=noto`. The page is clearly labeled as a design specimen, uses a snapshot of current SF-01 shell styles and official logos, and replaces image space with a neutral labeled placeholder. Generic title specimens are explicitly not catalog products. Shopping actions are disabled; no catalog/database writes or storefront API behavior are involved.

This path is the visual-review surface until approved garment photography is supplied. It contains no PILOT PODCAST artwork. The normal application at `http://localhost:3000/` remains the functional integration preview with its original local data; it is not the photography-evaluation surface. No image was removed from the real catalog and no fake merchandise/campaign imagery was uploaded.

The preview is an ignored scratch artifact, not a new application route, CMS, production feature or SF-02 implementation. It is a snapshot and must be refreshed when source styles change. Neutral placeholders allow typography/spacing review; they do not establish photography-led fashion acceptance.

## Header, footer and mobile confirmation

- Official horizontal logo remains unchanged. Header uses the compact existing scale; footer renders at approximately 140×59px, legible without competing with commerce.
- Public navigation remains simple and distinct from the staff application. Header/footer interactive targets measured at least 44px in the review surface.
- All three candidates returned HTTP 200 without normal browser errors or horizontal overflow at 390/1440px. Amiri also passed the 320px and blocked-font fallback checks.
- Existing SF-01 live/production verification covers phone/tablet/desktop routes, focus, reduced motion and corrected breadcrumb target. This static visual specimen does not replace functional browser tests or real iOS/Android testing.

## Evidence and commit boundary

Scratch evidence: `.scratch/storefront-foundation/final-review/README.md`, `verification.json`, and `screenshots/{amiri,cairo,noto}-{390,1440}.png`, plus `amiri-320.png` and `amiri-390-fallback.png`.

A final bounded CSS correction prevents busy buttons from adopting hover colors or overriding secondary/disabled palettes. Seven action variants passed 42 style assertions; live preview remained HTTP 200 without browser errors. The existing focused suite remains 6 passed / 1 baseline-reproduced checkout locator failure, documented in [foundation review](storefront-foundation-review.md). No test was removed or weakened.

The user authorized committing SF-01 after this review. Include the coherent approved roadmap/readiness/tickets and foundation source; exclude all unrelated working-tree changes. Do not push or start SF-02 as part of this request.

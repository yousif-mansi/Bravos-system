# Storefront GitHub checkpoint — 16 October 2026

This checkpoint publishes the reviewed English storefront implementation and category-browsing revision for review. It is not final visual acceptance, a production release, a deployment, or a merge to main.

## Included work

- Dependency-complete storefront application: dark branded shell, official image-only hero, owner-authorized Clash Display/Rose font files and notices, product presentation and variant selection, bag preview, English checkout and customer information/metadata pages.
- Progressive horizontal category rows, centered card titles, rounded edge-to-edge 4:5 cover images, default/price sorting and removal of customer search/product totals.
- Public catalog search-filter removal and staff replacement-search compatibility, without changing public response shapes, stock, ordering, permissions or recovery rules.
- Matching browser/API/script coverage and current owner instructions/plans. Three stale browser entry paths were corrected during publication review: the purchase journey uses visible category navigation; analytics/media tests approach their actual category rows before waiting for progressively mounted cards. Their commerce and analytics assertions remain intact.
- Only the previously requested Windows runner changes in CI. The unrelated sample-intake CI test step remains local and unstaged.

## Evidence and limits

The detailed category review is [storefront-category-browsing-review-2026-10-16.md](storefront-category-browsing-review-2026-10-16.md). It retains all failed runs and separate reruns, including the nine capture/coverage failures from the 397-image development capture. Final visual supplements remain pending the unchanged Windows memory guard.

Recorded gates include workspace typecheck, architecture checks, storefront builds, nine HTTP tests, a separate six-case browser repair run, and the final touch/wheel/keyboard regression. They are prior working-tree evidence, not a new full acceptance run of this publication commit. In particular, those local browser/HTTP runs used a separate Windows testkit teardown repair that is deliberately excluded from this storefront checkpoint. Exact-commit hosted Windows CI results remain pending.

Publication checks passed: seven metadata/contact helper tests and discovery of nine scenarios across the three repaired browser specs plus the flagship spec. No fresh browser execution is claimed for these publication-only repairs. The staged whitespace check also exposed and removed two trailing EOF whitespace characters from the new category component; no application behavior changed after the captured source. No local memory guard was bypassed to obtain a result.

## Exclusions and change control

Excluded: staff product/receiving UI work, sample intake scripts/assets and data, local databases/media stores, generated Next output, dependency caches, original font-source folders, export font, testkit teardown changes, unpublished policy draft, and the protected Grok review file. No merchandise records or production settings are changed by publishing this checkpoint.

The publication manifest and cached diff are recorded locally under `.scratch/category-storefront-20261016/review/`. The owner explicitly authorized publication after the engineering/visual review report; a draft PR keeps remaining acceptance visible. No issue closure, automatic merge or deployment is part of this checkpoint.

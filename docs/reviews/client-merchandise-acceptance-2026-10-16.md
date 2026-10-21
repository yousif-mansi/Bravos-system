# CA02 — Daily merchandise work, 2026-10-16

Pending main review. Source review found the existing Products and Receiving filters already meet the daily find-and-keep task. Two employee-facing corrections were applied. No API, schema, permission, stock, or recovery rule change. No commit, push, or service run. `docs/reviews/bravos-v1-grok-review.md` remains SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

## What the employee sees

A manager receiving stock for an existing garment now meets the receipt immediately after the branch, instead of scrolling through category setup and new-product preparation. The receipt heading keeps its uncertain-operation title and the saved-operation notice when a receipt is still unresolved. **إضافة منتج جديد** sits beside that heading and moves focus to the existing new-product form, which stays on the page with the category, size, and color forms. Products was left as already verified.

On the bag, a check that finds the same price and availability now says the details were checked and points to the checkout total. A real price or availability change still warns the customer to review the changes.

## Changed files

- `apps/internal/src/pages/ReceivingPage.tsx` — receipt form moved to follow the branch selector; new-product shortcut uses the existing reveal hook.
- `apps/storefront/app/cart/page.tsx` — healthy check sentence only.
- This report.

`CatalogPage.tsx`, `styles.css`, and both merchandise browser specs were not edited. Existing form names, field ids, and test ids are unchanged, so the specs did not need selector updates.

## Acceptance

| Task | Result | Evidence |
| --- | --- | --- |
| Desktop category, name, and SKU filters, including descendant match, trim/case, empty result, and clear | Already in place. Main's fresh screen check: category 8/32, name/SKU 1/32, no match 0/32, clear 32/32. Not refactored. | `CatalogPage.tsx` 82–99, 416–417, 741–774; `ReceivingPage.tsx` 99–116, 154–172, 1014, 1168; `catalog.spec.ts` 242–297; `receiving.spec.ts` 800–841 |
| Edit stays when a filter hides the product | Already in place. The open form is separate from the filtered list and uses the existing reveal. | `CatalogPage.tsx` 335–361, 562–564; `catalog.spec.ts` 290–297 |
| Receiving choice stays when search or category changes | Already in place. The current choice remains under الاختيار الحالي. | `ReceivingPage.tsx` 154–172; `receiving.spec.ts` 810–841 |
| Sparse pairs and branch stock | Unchanged. A partial size/color set stays valid. Quantity is still recorded for the selected branch. | `catalog.spec.ts` 300–382; `ReceivingPage.tsx` 485, 979–989 |
| Cashier has no receiving or cost | Unchanged route and navigation. The cashier case still expects no receiving link and no cost wording. | `nav.ts` 40; `receiving.spec.ts` 162–180 |
| Receipt is the first daily task | Applied. Branch, then receipt, then taxonomy, then new-product intake, then the receipt list. | `ReceivingPage.tsx` 979–989, 991–1135, 1137–1155, 1157 |
| New product is one action away | Applied. Secondary button, existing `useRevealFeedback`, same highlight class and heading focus as receipt details. | `ReceivingPage.tsx` 305–307, 992–995, 1157–1158 |
| Uncertain receipt stays obvious | Applied. Heading and `pending-operation` remain the first content of the receipt. | `ReceivingPage.tsx` 992–1000, 1117–1132 |
| Bag check does not claim a price change | Applied. `changed === false` only. Warning, failure, and idle copy kept. | `cart/page.tsx` 62–71, 101 |

## Validation

No server, browser, database, build, or Playwright run in this pass. Main owns the next check: the existing merchandise flows, the new-product shortcut on the moved receipt, and a refreshed bag whose details did not change. The earlier screenshot run is finished, so the bag sentence no longer conflicts with capture.

# Business UX refinement — approved execution scope, 18 October 2026

Completion: the bounded implementation and local checks are recorded in the [final UX and Windows verification review](../reviews/business-ux-windows-ci-2026-10-18.md). The plan below preserves the original execution scope; it is not a list of remaining implementation work.

This is a task-focused refinement of the current Bravos product. Keep the approved dark brand, official assets, Cairo staff typography and English Clash storefront. Do not replace the interface with a new design system. Main owns these product decisions; Grok implements; independent reviewers and main verify.

## What the review established

| User problem | Decision | Acceptance |
| --- | --- | --- |
| Receiving history pushes stock alerts below 53,000px. | Keep receipt entry first. Put receipt and cost-batch archives in bounded, expandable sections. Keep active details/corrections and real warnings outside the collapsed lists. | Routine work and low-stock information are reachable without traversing the archive; every original record remains accessible. |
| POS shows two equally prominent size/color selection methods. | Make valid pair buttons the immediate choice; retain dropdowns as a secondary alternative. | One-click pair choice still works; keyboard focus stays visible; selections and accepted prices persist. |
| Technical staff identifiers interrupt order details. | Put exact IDs in an expandable attribution detail, with action/date prominent. | No fabricated employee names, no lost audit facts, no API change. |
| Backup instructions dominate the download task. | Keep a short scope statement, image limit and synchronization warning visible; disclose technical contents separately. | Password/download fields are easier to find; validation, privacy and all real warnings remain. |
| Returns use different labels for one receiving branch and accounting jargon for confirmation. | Use “فرع استلام المرتجع” and an explicit receipt/inspection action. | Original-sale branch remains distinct; stock inspection and refund payment remain separate and clear. |
| Public variant visibility mixes bulk helpers with individual switches. | Keep actual variant pairs primary; move bulk size/color choices into a labelled secondary group. | Sparse existing pairs, POS variants and the saved draft are preserved. |
| Checkout repeats the same price-review explanation. | Keep one clear instruction next to the review action and retain the authoritative breakdown, COD and pending-request disclosures. | No changed-price, reservation, uncertain-result or recovery safeguard is weakened. |
| Report scope requires reading long paragraphs. | Put short, visible scope labels beside global snapshots and period totals. | No filtered-looking total that actually covers all branches; no reporting calculation changes. |
| Expense details duplicate unchanged original/current values. | Show the effective expense first and retain originals/history behind a clear disclosure. | Cancellation status/reason and correction controls stay visible; complete history remains accessible. |

## Visual corrections

The Windows practice baseline measured enabled input boundaries at 1.24:1 in dark and 1.45:1 in light. The active light navigation label measured 3.53:1. These are demonstrated contrast defects. Existing helper, checked-label, success and focused-field pairs passed.

Use narrowly scoped semantic control borders, readable active navigation and a distinct primary-action fill. Preserve the brand palette and existing card surfaces. Improve danger/error text pairs without introducing new colors for business states. Disabled controls are not reported as contrast failures. Source-only danger/error concerns are not presented as live error-state measurements.

The review follows [W3C guidance on contrast, labels and errors](https://www.w3.org/WAI/tips/designing/) and [Fluent guidance on clear button labels and action hierarchy](https://fluent2.microsoft.design/components/web/react/core/button/usage/). These are interaction references, not dependencies to install or a replacement visual identity.

## Engineering follow-up

PR44 remains open/draft at 6eacfa8. Run38912267680 passed static/build and failed its two Windows database-dependent jobs. Logs and installed dependency code establish that the native PostgreSQL process closes before readiness and the dependency rejects without an error value. The subsequent undefined cleanup errors and browser webServer failure are consequences. The native exit reason was not retained, so its underlying cause is still unconfirmed.

Grok is implementing an isolated Windows startup correction that preserves the child environment and reports bounded, sanitized native failures. Local verification and a fresh hosted Windows result must be recorded separately. No Linux work, production startup workaround, business-data changes, dependency upgrade or deployment is authorized by this pass.

## Tracker boundaries

Five GitHub issues remain open. Their older Arabic storefront, customer-search and real-photo prerequisites are superseded for the owner-approved English sample-catalog preview. Optional factual product chapters remain optional. Production measurements and operational release acceptance are separate from this local UX/engineering pass. Do not close mixed criteria without evidence or invent content to satisfy an outdated checklist.

## Verification and publishing

Run the relevant type/architecture checks, focused changed-interface business cases, Windows startup/HTTP checks and native-size visual/contrast review. Preserve failed attempts beside reruns. Do not repeat all historical storefront captures or the full browser suite without a new reason.

No commit, push, merge, issue closure or deployment without the owner's required approval. Complete the reviewable diff and verification before asking for a publishing checkpoint. Current task status and actual outcomes belong in the final review; this document records decisions, not a completion claim.

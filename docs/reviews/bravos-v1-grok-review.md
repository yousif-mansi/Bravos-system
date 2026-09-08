# BRAVOS v1 specification: Grok review and disposition

Date: 2026-09-08. Review requested by the user through the grok-delegate skill.

## Result

Grok reviewed the full specification against the business brief, discovery decisions D01-D51, Returns agreement, architecture principles/ADRs and blueprint. It found no P1 contradiction and described the draft as faithful to the 63 answered questions. It identified seven P2 completeness/wording findings, two P2 policy proposals and five P3 clarifications/test gaps.

The orchestrator checked the findings against the source decisions and revised the [specification](../planning/bravos-v1-spec.md). It now contains **114 user stories and 36 acceptance scenarios**. Source-backed clarifications are incorporated; new policy and implementation extensions remain expressly proposed. This review does not approve those proposals or publish a ready-for-agent issue on the user's behalf.

The [original Grok report](bravos-v1-grok-original-review.md) preserves its findings and full coverage matrix. Its line references and counts refer to the pre-correction draft. The disposition below is the current result; the original report's unresolved wording is historical.

## Finding-by-finding disposition

| Grok finding | Orchestrator assessment and change | Status |
| --- | --- | --- |
| P2-1: sale cancellation versus physical stock | D20 already requires actual effects. Strengthened story 41 and the saved-record command so the Cancel label cannot imply physical return or cash refund. A recording error may still justify an explicit stock reversal; it does not require inventing a customer return. | Clarified |
| P2-2: accepted till pause shown as proposed | D37 accepted known-till synchronization and the brief stock-changing-work pause. Promoted that requirement in story 28 and the FIFO section; only count-boundary/device-acknowledgement mechanics remain proposed. Aligned the blueprint. | Corrected |
| P2-3: exchange value/direction shown as proposed | D43/D50 settle credit from the manager's final return value, current replacement price after offers, and cash collected/refunded for the difference. Made that accepted rule explicit in story 88, the spec, Returns document and blueprint. A26 now covers both 280-to-320 (collect 40) and 280-to-200 (refund 80). | Corrected |
| P2-4: promotion/coupon user stories missing | Implementation and A10 already covered these, but decomposition from stories could miss the user workflows. Added stories 108-113 for manager offers/bundles/rewards/coupons, eligibility/combination settings, application and usage lifecycle; added A34. | Corrected |
| P2-5: delivery-area administration story missing | Added story 114 and A35 for manager-maintained supported Fayoum areas and fees used by checkout. Actual values remain launch configuration. | Corrected |
| P2-6: representative authorization not explicit enough | Actor wording already named the representative/manager. Strengthened the confirmation command and A01 to require that grant and expressly reject an ordinary cashier performing order transitions. | Clarified |
| P2-7: replacement quantity/allocation checks incomplete | Added an exchange command and explicit replacement quantity validation, reserved-stock exclusion and FIFO allocation in Returns/A26. Original-batch restoration is a distinct movement; actually inspected sellable units may increase availability, but expected/unsellable returns may not. | Corrected |
| P2-8: coupon usage after failed delivery/customer return | Added a labelled proposal: manager terminal cancellation of a failed, undelivered order after receipt/inspection releases consumed usage once; failure/stock receipt alone does not. Delivered customer returns retain usage under the proposed default. This does not turn a parcel in transit into an ordinary pre-shipment cancellation. A36 covers the proposal. | Proposal, awaiting existing final review |
| P2-9: reward-unit paid value on return | Added a labelled proposal preserving the reward unit's stored paid value, often zero, without repricing retained items. A zero suggestion does not block an eligible return or manager refund editing. A36 covers it. | Proposal, awaiting existing final review |
| P3-1: Arabic stage labels absent from remainder | Further Notes identifies labels as a UI design detail, using the blueprint's proposed Arabic labels without reopening lifecycle decisions. | Clarified |
| P3-2: employee deduction story omits coupon order | Story 36 now explicitly follows configured offers and any eligible coupon. | Clarified |
| P3-3: optional checkout fields not explicit at API boundary | The submission command and A35 now explicitly allow omitted alternate phone, landmark and notes. | Clarified |
| P3-4: initial online requirement not present in workflow stories | Stories 75 and 89 now state initial online Returns/expense operation, consistent with the existing offline scope. | Clarified |
| P3-5: POS versus confirmation race missing | Extended A11. Adapted the recommendation to preserve D03: only one allocation may win, but a cash sale already physically completed must still be retained and reconciled, not silently rejected because it lost the allocation race. | Added with D03 safeguard |

## Additional orchestrator checks

Two details were tightened while assessing Grok's exchange and cost findings. These are explicit implementation proposals, not newly attributed user answers:

- **Exchange credit versus cash:** credit already applied to the replacement cannot also appear as cash Owed or cash Paid. A 280/320 exchange records applied credit 280 and cash collected 40; a 280/200 exchange records applied credit 200 and cash refund 80. The full return and replacement merchandise values remain traceable for reporting. A26 checks this distinction.
- **Cost corrections followed by returns:** a recorded cost of 100 explicitly corrected to 140 retains the original 100 and linked 40 adjustment. A later sellable return must restore/reverse effective value 140 without leaving a 40 cost charge for the fully returned unit. A25 checks it; the blueprint is aligned. Receiving unrelated newer stock at 140 cannot reprice the old batch.

Some original findings were wording/test-strengthening requests rather than absent rules: sale corrections already required actual effects, and representative/manager roles were already named. The changes make these requirements easier to implement and verify. They are not claims that existing application code contained those bugs; no application exists yet.

## Verification and provenance

- Grok CLI 1.0.13 ran through the installed relay in read-only mode, using its configured model without an override.
- The initial sandboxed relay preflight failed before dispatch. The permitted retry read the sources but stopped at a shell-permission request, without producing the review. The same Grok session was resumed with file-reading tools only, and its final run ended with `end_turn` and exit 0.
- Session: `01a081d2-d043-71d3-91ff-e150c849f68b`. Final relay `readOnlyViolation=false`; the original spec SHA-256 still matched `6C9467E189BF4463F5223319C1A8864EEDBE89465813AEC089B50A1135E956D1` before the orchestrator's corrections. Pre-existing tracked/untracked planning work was retained.
- Grok did not make the corrections. The orchestrator updated the specification, blueprint and Returns document and saved the original review and this disposition. No app code, issue publication, commit, push, booking or deployment was performed.
- Document validation checks the seven required spec sections, continuous story/scenario numbering, local links, UTF-8/whitespace, example arithmetic and a spec body below 65,536 characters. Application tests remain future acceptance work, not executed evidence.

## Remaining review boundary

The agreed business scope remains intact: central inventory, final physical cash sales including offline, protected confirmed orders, separate FIFO cost batches, manager-editable refunds, 14-day dedicated Returns, employee discounts/expenses, required management reports and the public store. Excluded tax, courier accounting, average costs, extended in-app defect windows and Module Federation were not reintroduced.

The previously pending stack, calculation, recovery and test-boundary review is still pending. The two promotion edge-case defaults and additional implementation clarifications above join that same review; no new numbered interview is started. A review cannot guarantee that every future implementation defect or edge case has been eliminated, and the actual identity, synchronization, concurrency and backup guarantees must still be proven by implementation tests.

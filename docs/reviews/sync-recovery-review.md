# Synchronization and recovery review

Ticket 06 / GitHub issue #7 is independently accepted on 2026-09-15. Fixed baseline: `df408b0cfbce26a90a090bab7a94409e20d14af4`. Grok produced the initial implementation; native GPT-5.6 Sol agents completed repairs under the updated user mandate. Root reviewed the final source and independently verified the resulting behavior before acceptance.

## Review contract

Review the approved specification's A12 and A17–A21 against the final diff. Baseline ticket 05 passed 77 HTTP tests, 56 browser tests and all established gates. Preserve that coverage while extending safe acknowledgements and manager-assisted account recovery.

| Case | Required observable result |
| --- | --- |
| Atomic acknowledgement | Cache 5; complete A=1 and B=2 locally. A's central snapshot has 4. Applying its acknowledgement leaves 2 available and only B's effect outstanding. Interrupted persistence yields a complete old or new state. |
| Later local sale | Complete C=1 while A's response is delayed. Applying A leaves 1 available after B+C, preserving C's identity and pending status. |
| Stale response | Apply version 12/balance 2 after A+B, then delayed version 11/balance 4 after A. With C pending, availability stays 1. |
| Duplicate acceptance | Two tabs submit the same operation; lose a genuinely committed response, restart and retry. One sale/allocation/movement remains. Changed content under the same identity fails explicitly. |
| Account queues | A and B each sell 1 from cached 5. B cannot view or submit A's details. B's central acknowledgement of 4 minus A's effect leaves 3. Returning A recovers the unchanged queue. |
| Access changes | Expiration supports reauthentication without queue loss. Revoked identity or branch grant blocks new connected work but preserves earlier completed facts for manager assistance. Backdated client time is insufficient authorization. |
| Manager recovery | Preserve original employee, branch, operation, occurrence and paid values; attribute manager and recovery time. Ordinary employees cannot use recovery; retries apply once. |
| Late shortage | A completed sale of 3 meets only 1 allocatable unit at cost 60 and another protected unit. Preserve sale quantity 3, allocated quantity 1, shortage 2 and incomplete cost; retain protected stock. |
| Price and privacy | Accepted 300+200 minus 50 stays 275/175 after repricing and recovery. Employee responses/caches omit costs. Arabic statuses reflect durable results. |

## Standards

Final source review passes after repair. PostgreSQL clock locks serialize coherent stock snapshots and stock writers; sale, FIFO allocation and deduplication commit atomically. IndexedDB acknowledgement/rebase uses one transaction, with WebCrypto digest work outside that transaction and canonical facts revalidated inside it. Opaque content-matched proofs preserve cross-account privacy. Older valid acknowledgements cannot resurrect stock. Feature public interfaces and inward dependencies pass automated checks.

Preparation identified five concrete review targets, not findings against unfinished work: all availability writers must advance a coherent stock version; lock order must be consistent across receiving and sales without reacquiring a pooled connection; acknowledgement and snapshot persistence must form one local transaction; account-keyed price caches must use the newest shared stock state; and recovery must preserve server-held provenance, original attribution and account-generation guards. A sequence value by itself is not proof of transaction commit order.

## Spec

Final source and behavior review passes after repair. The acceptance cases above are covered by HTTP, IndexedDB and browser evidence, including genuine lost committed responses, overlapping submissions, a new pending sale during delayed acknowledgements, revoked/expired account recovery and production offline restart/reconnection. Recovery retains the original employee, branch, occurrence and paid values while recording the responsible manager. Completed physical facts survive shortages; protected stock is not consumed. No unresolved blocking finding remains in either review axis.

## Verification

Independent root verification passed typecheck, 90 HTTP tests in 7 files, production builds, architecture, migrations 001–009 (latest down/reapply, complete roundtrip and deliberate failing-migration rollback), and dependency audit with zero vulnerabilities.

The full browser run passed 64 of 66 tests, including all 9 synchronization cases and production offline restart/reconnect. Two older sales assertions assumed a single retry and immediate upload completion. Sol corrected only those assertions to tolerate valid asynchronous retries while asserting one accepted sale, unchanged operation identity and exact stock effects. Root then independently reran the complete sales browser file: 11/11 passed in 46.1 seconds. This is combined full-suite and targeted repair evidence, not a claim that a second complete 66-test run occurred. Typecheck was repeated after the test edits and passed.

Subsequent integrated verification on 2026-09-15, after adding expenses (07) and catalog/media (17), passed the complete expanded browser suite: 68/68 in 3.1 minutes. Evidence: `.scratch/sol-implementation/root-17-browser-all.log`.

Evidence: `.scratch/grok-implementation/root-sync-recovery-final-results.json`, `.scratch/sol-implementation/root-sync-final-test-browser.log`, and `.scratch/sol-implementation/root-sync-final-sales-browser.log`. The protected user review retains SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. Startup/cleanup failures from temporary test PostgreSQL workers remain in the logs; successful reruns completed the required checks.

## Historical review and repair log

The entries below describe earlier checkpoints and are superseded by the accepted outcome and verification above.

Root intentionally paused only the verified idle run1 Grok process after source review found partial-snapshot/global-version stock resurrection, incoherent version/quantity reads, missing knowledge of other committed operations, and stale account caches. Further root review found public-client access to other-account queues without a manager guard and missing recovery for completed connected records without a price snapshot. Receiving version participation, reconnect restrictions and duplicated recovery processing also require completion/recheck.

Run2 resumes the saved session `01a09fde-9e8e-7ad2-a3cd-e54e56cc841c` with `.scratch/grok-implementation/06-review-corrections.md`. These are unresolved review findings until corrected and verified. Saved code is preserved; the intentional pause was not a quota failure. There was no observed ticket06 red-before-green run before the initial source edits.

Run2 passed delegated typecheck and 9 focused HTTP tests after correcting a revocation fixture. Evidence: `.scratch/grok-implementation/06-run2-focused-http.log`. Source review confirms coherent clock locks, receiving version participation and shared account quantity overlays. Remaining findings concern pinned cart quantities at final commit, UUID-only inclusion of conflicting operations, discarded older valid acknowledgements, actual occurrence during prepared-sale recovery, the reconnect submission latch/branch checks, and delayed recovery responses. Test review also requires exact manager/occurrence/version assertions and a valid stale-stock shortage fixture, plus browser coverage. Root paused only the verified idle worker after its command completed and resumed run3 with `.scratch/grok-implementation/06-final-race-corrections.md`. No independent ticket06 verification or acceptance is claimed.

Run3 passed 10 focused HTTP tests (`06-run3-focused-http.log`). Read-only review confirms shared-cache final quantity validation and older valid acknowledgement processing repaired. Proof matching still ignored the supplied immutable payload fingerprint, and proof responses disclosed prior-account employee/amount/line details. Root waited for the active HTTP command to finish, paused only the verified idle worker, and resumed run4 with `06-proof-privacy-correction.md`. The correction requires opaque content-matched evidence, private account queues and completion of the remaining regressions/full gates. No ticket06 acceptance is claimed.

Run4 passed pinned-runtime typecheck and all 89 HTTP tests in 7 files (`06-run4-full-http.log`, 276.04 seconds). Final source recheck confirms opaque proof privacy and complete canonical matching. Browser review still requires genuine committed-response barriers, targeted acknowledgement storage failure, overlapping two-tab submissions, revoked/expired/prepared-sale recovery and production restart-to-reconnect coverage. Source review also found WebCrypto digest awaits inside active IndexedDB transactions that can close before later writes. Root waited for the HTTP command to finish, paused the verified idle writer and resumed run5 with `06-browser-evidence-corrections.md`. The IndexedDB watch is recorded in `06-run5-source-watch.md`; final repair and browser verification remain required. No independent ticket06 gate pass or acceptance is claimed.

Run5 passed 13 focused HTTP tests but all 7 focused browser tests failed at the initial local sale save. Evidence is preserved in 06-run5-focused-browser.log and 06-run5-browser-contexts. No worker remained active at the resumed checkpoint. Run6 now continues the saved Grok session with 06-indexeddb-browser-final.md, addressing WebCrypto awaits inside IndexedDB transactions plus delayed account-switch responses, foreground reconnect, older acknowledgement coverage and explicit expiry assertions. No independent ticket06 acceptance is claimed.

Run6 exited on 2026-09-14 at 18:04 Cairo with HTTP 402: Grok Build usage balance exhausted. The idle-pause helper found the worker already exited and stopped no process. Provisional Standards source review finds the digest-outside-transaction repair sound. The focused browser run reached later steps but failed all 9 cases: disabled second-sale color selection, a pending assertion racing a real acknowledgement, unfiltered shared sales-list counts, and an expired-session navigation transition. Evidence: 06-run6-focused-browser.log and 06-run6-browser-contexts. Spec review still requires actual delayed-response delivery/processing while B remains active, creation of C before the acknowledgement rebases, and two-proof transaction rollback/retry evidence. Exact corrections are in 06-final-evidence-delta.md. Saved changes remain uncommitted; no full independent ticket06 gates ran. Protected user review hash is unchanged and git diff --check passes.

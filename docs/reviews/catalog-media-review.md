# Catalog media and publication review

Ticket 17 / GitHub issue #18 is independently accepted on 2026-09-15. Candidate: `.scratch/worktrees/17-catalog-media`, baseline `df408b0cfbce26a90a090bab7a94409e20d14af4`, integrated onto accepted expense commit `844c4e0`. Native GPT-5.6 Sol at HIGH effort implemented; independent Standards and Spec reviews preceded root integration and verification.

The candidate adds manager product image upload/ordering/removal and an optional size guide, local file storage, role-filtered public catalog APIs, and a minimal Arabic public product list/detail. Full storefront browsing/cart remains ticket 18. Existing schema supplies image references and size guides; no migration is introduced.

## Standards

Two P2 findings were repaired and independently rechecked:

1. Concurrent upload and product save can reset the draft before uploaded references are attached; partial upload failure can also discard successful references. Serialize those actions and retain/report successful partial results.
2. The client reads entire selected files before enforcing the 5 MiB limit. Check size before FileReader to protect phone-friendly management from excessive memory use.

Authorization, path boundaries, role-filtered DTOs and feature interfaces otherwise conform to the documented standards. Public responses omit restricted cost and internal data.

## Spec

Three findings were repaired and independently rechecked:

1. P1: Next's optimized image cache can serve a previously public image after its product becomes Hidden or its reference is removed. Render media through a path that rechecks current publication on each request and test the actual rendered URL.
2. P2: signature-only validation accepts corrupt image bodies that cannot render. Validate decoding before storing, with bounded resource use.
3. P2: browser coverage must exercise an all-zero Available product that remains browsable with the Arabic Out-of-Stock label and disabled variants.

All three are resolved in the integrated source. Global Next image optimization is disabled as well as per-image optimization, so direct optimizer requests cannot keep a revoked image accessible. Publication is checked on raw media requests with no-store responses. Sharp validates complete decoding before writing, bounded to 5 MiB, 8000 pixels per edge and 20 million pixels; reads do not repeat expensive decoding. Public Out-of-Stock coverage now exercises the all-zero product before receiving stock, then mixed availability, removal and Hidden state.

Upload/save use separate busy state that cannot be cleared by concurrent taxonomy edits. Successful uploads remain in the draft when a later file fails, with an explicit partial-result message and draft-version guard. Oversized files are rejected before FileReader or an upload request. The browser regression holds an upload response while editing taxonomy and verifies saving remains disabled.

## Verification

Root integrated the candidate onto accepted expense commit `844c4e0`, preserving synchronization and expenses. Independent typecheck, 14 catalog HTTP tests, production builds, bundle separation, architecture (134 modules / 340 dependencies), and audit (zero vulnerabilities / 644 dependencies) pass. The full integrated browser regression passed 68/68 in 3.1 minutes, including catalog publication, expense corrections, stock receiving, cash sales, synchronization/recovery and production offline behavior. No new migration is introduced, so the verified 001–010 migration checks remain applicable without changes. No unresolved blocking finding remains in either review axis.

Root logs: `.scratch/sol-implementation/root-17-{typecheck,http,build,architecture,audit,browser-all}.log`. Delegated browser repair evidence includes 3 supporting catalog/public-entry cases and the final media case; exact taxonomy-save waits replaced a fixture race without weakening business assertions.

The public pages are the minimal catalog for ticket 17. Full browsing/search, guest cart, configurable contact links and storefront scale/performance refinements belong to ticket 18. The public image route deliberately rechecks visibility; any later image optimization must preserve revocation rather than restoring the optimizer-cache bypass.

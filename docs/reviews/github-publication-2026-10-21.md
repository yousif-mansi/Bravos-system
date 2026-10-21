# GitHub publication checkpoint — 21 October 2026

The owner authorized publishing the latest completed edits to `main`. The checkpoint includes staff product/category organization and business UX, checkout copy, Windows test infrastructure, affected tests, sample-catalog intake tooling and 30 optimized fictional product images, plus the associated plans and review evidence.

## Verification supporting this checkpoint

The [18 October review](business-ux-windows-ci-2026-10-18.md) records workspace typecheck, architecture, staff build, 28 pure Windows infrastructure tests and 260 HTTP integration tests passing. Its original browser run was 16 passed / 3 failed; a separate corrected six-case run passed, including all three failed cases. Thirty-four after-build screenshots were individually inspected across the documented runs. These are dated results, not a newly repeated full suite or hosted CI approval.

On 21 October, the 14 pure sample-intake guard tests passed again using pinned Node 22.23.3. All 30 optimized image hashes matched their provenance. Image provenance was made portable by removing absolute workstation paths; catalog facts and image bytes were unchanged. Development guides were corrected to distinguish the completed local practice checks from earlier memory-blocked attempts and from live service health.

## Exclusions and limits

The protected `bravos-v1-grok-review.md` remains outside the checkpoint, unchanged at SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. Local credentials, databases, runtime media, screenshots/logs, dependency caches, build output, source-font folders and the unused Noto report font are excluded. No sample-intake command, stock mutation, deployment or hosting operation is part of publication.

Before publication, GitHub PR #44 was open/draft on `codex/ux-purchase-guidance`, with published head `6eacfa8a4846275cfe8294a48df31ee109fcd659`. `origin/main` was its direct parent. The previous hosted run had passed static/build checks and failed HTTP/browser startup. A fresh Windows hosted run after publication is still required before claiming those hosted failures resolved. The historical underlying native exit cause remains unconfirmed.

Publication is a source checkpoint, not client acceptance or production launch approval. Historical review reports retain their original dates and failure/rerun distinctions.

# Business-data backup review

Ticket 26 / GitHub issue #27. Baseline: accepted ticket 24 commit `4647300`. Sol HIGH backend and UI lanes implemented the backup from an older base (`e24c4fb`). Claude (root) rebuilt only the backup work on top of `4647300`, ran independent Standards and Spec reviews, repaired the findings and verified the result. Restore (ticket 27) is not part of this change.

## Scope

A manager creates a password-protected business-data download from the internal app. The API reads one repeatable-read snapshot through a reader owned by each feature (identity, catalog, inventory, receiving, sales, expenses, pricing, returns, corrections, online orders, storefront configuration, opening import, analytics), wired in `apps/api/src/app.ts`. The archive is canonical JSON encrypted with scrypt-derived AES-256-GCM, with a versioned manifest, per-section counts and SHA-256 checksums, stable IDs, the stock-clock version and the online-order reference sequence. Credentials, sessions, verification and recovery rows are excluded; staff appear only as a sanitized actor projection. Image references are kept and image binaries are not included. Known unsynchronized tills are shown before download and recorded in the manifest. The download is verified by checksum in the browser and never cached. No migration is added.

## Rebuild

The old lanes carried stale copies of tickets 21–25. Only backup files and backup hunks were ported. Rebuild decisions:

- The analytics backup reader removed in ticket 24 returns as a feature-owned `postgres-backup.ts` adapter.
- Stock version and the reference sequence are read by the inventory and online-orders readers instead of the backup adapter querying their tables.
- New `backup-isolated-by-ports` dependency and private-import rules keep the backup package away from other features.
- The UI lane's `features/backup/` folder and `api-error.ts` were collapsed into `apps/internal/src/backup-api.ts`, matching `report-export.ts` and `returns-api.ts`.
- Two lane typecheck errors (archive narrowing, optional abort signals) and a test import that could not resolve were fixed.

## Standards

Independent review found one P2 and five P3 findings. Resolved:

- P2: the whole backup was built in memory with a 512 MiB cap that JavaScript strings could not actually reach. The payload size is now estimated as each feature reader returns, capped at 128 MiB with an Arabic response, the archive cap is 192 MiB, one backup runs at a time per API process (409), and the response is sent without an extra copy.
- Backup validation uses the shared `VALIDATION` code; the manager check matches reporting (disabled account 401, non-manager 403).
- The download object URL is revoked after one second, as in report exports.
- Decoder tests assert the specific archive error, and business fixtures are created through application routes.

Accepted limit (P3): the size estimate is checked after each feature's tables load, so one very large table is still read before the cap applies. This is documented in `docs/development/backups/archive-v1.md`. Heuristics not applied: the repeated per-feature table loop, `SELECT *` without column allowlists outside the identity projection, and scrypt `N=2^15` (below current OWASP guidance; the 12-character password minimum partly compensates).

## Spec

Independent review found two P2 and two P3 findings. Resolved:

- P2: DATE columns were archived as JavaScript instants, so a business date could shift by the server time zone. The backup transaction now uses UTC and keeps date, time, timestamp and interval values as PostgreSQL text; timestamps also keep microsecond precision.
- P2: consistency coverage was limited. A new test creates a receipt with cost correction, a FIFO sale, a corrected expense and a confirmed online order through the API, then checks for every archived table that the manifest count equals the decoded rows and the live row count, that allocations reference archived batches, and that the stock version and reference sequence match live values.
- The tamper test now changes authenticated ciphertext rather than framing.
- The browser test decrypts the actual downloaded file.

Kept by decision: the manifest's `identityPolicy` and `idProvenance` fields overlap, but the ticket 27 restore lane validates this format. Foreign-key checks between archived rows belong to restore staging. The size cap and single-process lock are documented. Final Spec verdict: all four acceptance criteria met.

## Verification

Red before repair: with raw temporal parsing disabled, the new date/timestamp assertions failed; they passed after the repair.

Environment: typecheck, builds, architecture, migrations, audit and focused tests ran in the user's desktop Linux workspace; full HTTP and browser suites ran on the identical candidate in a Linux cloud workspace. Earlier accepted tickets were verified on Windows; this is not a Windows result.

| Check | Result |
| --- | --- |
| Workspace typecheck | Passed |
| Focused backup HTTP | 3/3 |
| Full HTTP against real PostgreSQL | 203/208 in 26 files. All 3 backup tests and every non-reporting file passed. The 5 failures are ticket 23 reporting tests that also fail on unchanged `4647300` when run after Cairo midnight on 17 September (see below) |
| Production builds and bundle separation | Passed; backup page is its own lazily loaded chunk, excluded from the service worker, with no archive implementation in staff or storefront builds |
| Architecture | Passed: 272 modules / 833 dependencies; private-import check 234 files |
| Migrations 001–028 apply/down/reapply | Passed; no new migration |
| Dependency audit | No known vulnerabilities |
| Browser, focused backup | 3/3, including decrypting the downloaded file |
| Full browser suite | 97/98; the only failure is the known `online-returns.spec.ts` environment failure |
| `git diff --check` | Passed |

Known issue outside this ticket: five reporting HTTP tests from ticket 23 depend on the real calendar date and fail when the wall clock is no longer 16 September 2026 in Cairo. They failed identically on the committed ticket 24 baseline at 00:30 Cairo on 17 September, and passed on 16 September. This is recorded for a ticket 23 follow-up; ticket 26 does not change reporting.

Evidence: ignored `.scratch/claude-ticket26/` (`root-26-*` logs and the candidate patch).

The unrelated user edit in `docs/reviews/bravos-v1-grok-review.md` is preserved and excluded.

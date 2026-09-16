# Report exports and aggregate analytics review

Ticket 24 / GitHub issue #25. Baseline: accepted ticket 23 commit `ad32f9e`. Sol HIGH backend and UI lanes implemented exports and analytics in parallel with ticket 23. Claude (root) rebuilt the ticket 24 delta on top of the accepted ticket 23 commit, ran independent Standards and Spec reviews, repaired the findings and verified the result.

## Scope

Managers export the currently applied management report filters as Arabic PDF and right-to-left Excel files. Exports reuse ticket 23's bounded report snapshot, so totals come from the same builder as the screen, and stay behind server authorization. PDF and Excel rendering is server-only and loaded on demand; nothing reaches the staff POS bundle, service worker or public storefront.

The storefront records anonymous visits, product views and successful cart additions without cookies, visitor identifiers or local storage. The manager analytics view shows those counts beside accepted order submissions and delivered online sales, each with a plain Arabic definition and no unique-person or conversion claims. Public events are replay-safe by operation identity. Migration 028 adds only the aggregate event table and guards its downgrade.

## Integration

Rebuilding onto `ad32f9e` resolved the API import conflict by keeping both sides and removed a duplicate export-limit error handler, because ticket 23 already gives that error an Arabic message and code. Existing issues surfaced and repaired during integration: the staff export helper failed typecheck; the migration 027 rollback test assumed 027 was the latest migration; ticket 24's edit to the ticket 23 reporting browser test sent a Returns field the committed contract rejects, so it was dropped.

## Standards

Independent review found one P1, one P2 and three P3 findings. Resolved:

- P1: the built API marked `react`, `@react-pdf/renderer` and `@ayocore/exceljs` external but did not declare them, so production exports could not load. The API now declares them, and the API build fails if any external cannot be resolved from `apps/api/dist`.
- P2: analytics queried Online Orders tables directly. Order submission and delivery counts now come through an analytics port implemented by the Online Orders reporting reader and wired in the API entry point.
- Export tests now inspect file contents, use the real export route with seeded volume instead of replacing the application's own modules, and export sheets show responsible names beside staff IDs.
- The unused analytics backup reader was removed; backup work adds its own reader.

Heuristics not applied: sheets are still built separately for preflight and rendering, the manager analytics chunk keeps its name, and one test still checks event-table columns directly. Presentation formatting is keyed on column labels in one place (`report-sheets.ts`). The narrow recheck found no remaining Standards blocker.

## Spec

Independent review found two P2 and four P3 findings. Resolved:

- Generated files are verified: the HTTP test loads the Excel workbook and compares summary totals with the API report, checks right-to-left sheets, formula-safe Arabic text, Cairo-time columns and responsible names, and checks the embedded PDF font.
- Export timestamps use Cairo local time with an explicit label instead of UTC.
- Money exports in Egyptian pounds with two decimals rather than piasters.
- Missing profit reads "incomplete — unknown cost", matching the report screen.
- The visit definition states one count per full storefront load, not per in-site navigation.

Accepted limitation: the public analytics endpoint has no rate limit, consistent with the other public endpoints today. Anyone can inflate visit, product-view and cart-addition counts; accepted submissions and delivered sales come from order records and cannot be forged this way.

## Arabic PDF rendering

Rendered pages were inspected with Poppler 22 (`pdftoppm`, `pdftotext`) and PDFium (`pypdfium2`). With the original Noto Sans Arabic font, `@react-pdf/renderer` misplaced letter dots and dropped some initial letters (for example "نوع" rendered as "وع"; text extraction read "تقرير" as "قرتر"). Padding and direction changes did not help, and Noto Naskh Arabic showed the same defect. Cairo Regular (OFL) renders the same report correctly in both renderers, including Latin digits. The asset was replaced and its provenance and SHA-256 recorded in `packages/report-export/assets/README.md`. Automated tests confirm the Cairo font is embedded; the shaping check itself is this recorded visual inspection. Rendered pages are kept in ignored `.scratch/claude-ticket24/`.

## Verification

Red before repair: the API build failed resolving `react` from the built API, and the file-content assertions failed on pounds, Cairo time and the missing name column. All passed after the repairs.

Environment: typecheck, builds, architecture, migrations, audit and focused tests ran in the user's desktop Linux workspace; full HTTP and browser suites ran on the identical candidate in a Linux cloud workspace. Earlier accepted tickets were verified on Windows; this is not a Windows result.

| Check | Result |
| --- | --- |
| Workspace typecheck | Passed |
| Focused export/analytics and reporting HTTP | 11/11 |
| Full HTTP against real PostgreSQL | 205/205 in 25 files, single run |
| Production builds and bundle separation | Passed; export runtime and font absent from staff, service-worker and storefront builds; every API external resolves from the built API |
| Architecture | Passed: 249 modules / 759 dependencies; private-import check 211 files |
| Migrations 001–028 apply/down/reapply | Passed, including the guarded 028 downgrade |
| Dependency audit | No known vulnerabilities |
| Browser, focused analytics/exports | 3/3 |
| Full browser suite | 91/95; three offline/sales timing failures passed their focused recheck 3/3 |
| Pre-existing browser failure | `online-returns.spec.ts` fails identically on `9d988d3` in this environment (ticket 23 review); not caused by ticket 24 |
| `git diff --check` | Passed except upstream trailing whitespace in the retained OFL license text |

Evidence: ignored `.scratch/claude-ticket24/` (`root-24-*` logs, rendered PDF page images and the candidate patch).

The unrelated user edit in `docs/reviews/bravos-v1-grok-review.md` is preserved and excluded.

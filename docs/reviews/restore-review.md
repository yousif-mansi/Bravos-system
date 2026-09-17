# Staged restore review

Ticket 27 / GitHub issue #28. Baseline: accepted ticket 26 commit `6aa2c62`. Sol HIGH backend, feature-adapter and UI lanes drafted the restore from an older base. Claude (root) rebuilt only the restore work on top of `6aa2c62`, ran independent Standards and Spec reviews, repaired the findings, obtained narrow rechecks and verified the result.

## Scope

A manager uploads a ticket 26 archive on **استعادة البيانات**. The archive is decoded, business writes pause and every archived table loads into an independent PostgreSQL staging database through a restore adapter owned by each feature, wired in `apps/api/src/app.ts`. While paused, a normal backup of live data becomes the pre-restore checkpoint and is merged into the staging database. Archive-only rows are added and newer live rows kept. A row whose values differ between the archive and live data, or a login-name collision, blocks the preview. Every known till confirms a post-pause snapshot, and only once its pending completed sales are held by the server. The manager downloads and confirms the checkpoint, then activates by fingerprint in one transaction. Activation reloads all feature tables, restores the reference sequence, advances the restore generation, resets tills and revokes sessions. Paid sales that arrive during a pause or from an older generation are retained and recovered once by a manager. Migration 029 adds restore tables, generation columns, the write barrier and a guard trigger on every business table. The full flow is described in `docs/development/backups/restore.md`.

## Rebuild

Only restore files and restore hunks were ported. Rebuild decisions:

- New `packages/restore` package with the standard `domain`, `application/ports`, `adapters`, `index.ts` and `node.ts` layout; boundary rules added to dependency-cruiser, the private-import check and the bundle check.
- Draft SQL that crossed features (restore runtime reads in Sales and Inventory, known-till generation updates, the reference sequence) moved behind ports owned by those features.
- Draft conflict markers and a completed-sale generation taken from the wrong record were fixed.
- The draft UI's per-5-second snapshot issuing, snapshot issuing at sale preparation and 401 session invalidation in `App.tsx` were not kept; they broke boot and existing browser tests.
- `RestorePage` uses `apps/internal/src/restore-api.ts`, matching `backup-api.ts`.

## Standards

Independent review found one P1, one P2 and ten P3 findings. Resolved:

- P1: cashier pages issued a POS snapshot every five seconds. They now poll the read-only `GET /api/internal/restore/pause` and synchronize once per observed pause and queue state or after a generation change.
- P2: the 270 MiB upload was read before authorization and copied several times. A route-level manager check runs before the body is read, and base64 decoding uses `Buffer` in the composition root. The remaining copies are documented as an operating limit.
- P3s: the generation is rechecked inside the sale transaction; deferred sales are marked reconciled in the recovery transaction; only data errors return 400 and server faults stay 500; the schema is checked before pausing; a migration test requires a guard trigger on every business table; retained sales use `SALE_RETAINED_FOR_RESTORE`; cleanup failures raise `AggregateError`; a dead alias and casts were removed; new files are not executable.

Accepted P3s: the backup decoder names exact schema versions (`028`, `029`), consistent with ticket 26. A later migration must add its version, and the backup HTTP test fails until it does; this is documented in `archive-v1.md`. `SaleRestoreGenerationChangedError` shares `RESTORE_STALE` with a stale preview. Heuristics not applied: per-feature adapter helpers and the restore table order are repeated, as in the backup readers.

Recheck: no new P1/P2; the expense foreign-key repair below conforms.

## Spec

Independent review found one P1, three P2 and several P3 findings. Resolved:

- P1: live data overwrote archived rows with the same key, which could activate an incoherent mix. Conflicting rows now block the preview; archive-only and newer live rows merge.
- P2: the preview claimed totals verification and hid merged counts. The wording now says links and record counts were verified, and the page shows archived, live, restored, archive-only, newer and conflicting counts.
- P2: a retained connected sale lost its prepared row. The prepared sale is embedded in the retained payload. The fresh-install case, where the server never held the prepared row, stays manual and is documented.
- P2: no tests covered newer activity or totals. HTTP tests now prove a newer receipt survives, a changed category blocks, and remaining stock, sales totals, allocated cost, expenses and delivery areas match after restoring into a fresh database.
- P3s: a missing connected-sale generation means current; a legacy `028` archive preview is tested; limits are documented.

Accepted P3: an unrecoverable fresh-install retained sale has no dismiss action and stays listed as pending (documented). Final Spec verdict: acceptance criteria 1–4 met; criterion 5 depended on the full browser run, which is recorded below.

## Late defect found by the full browser suite

The browser restore test passed alone but failed in the full suite: the preview stayed paused with the merge blocker. The cause was the cyclic expense pair. `expense_operation_expense_fk` was made deferrable, but PostgreSQL checks `ON DELETE RESTRICT` immediately even when deferred, so clearing expenses failed whenever any existed. Migration 029 now declares it `ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE`, which is unchanged for normal writes because expenses are never deleted; the down migration restores `RESTRICT`. Red first: the restore HTTP test extended with an expense failed with the preview stuck paused, then passed after the repair.

## Verification

Environment: all checks ran in a Linux cloud workspace on the candidate tree, not on Windows. Earlier accepted tickets were verified on Windows.

| Check | Result |
| --- | --- |
| Workspace typecheck | Passed |
| Focused restore and migrations HTTP | 11/11 |
| Full HTTP against real PostgreSQL | 208/213 in 27 files. All restore, backup and migration tests passed. The 5 failures are the known ticket 23 date-dependent reporting tests (see below) |
| Production builds and bundle separation | Passed; restore page is its own lazily loaded `manager-restore` chunk, excluded from the service worker, with no restore package, write-barrier function or staging names in staff or storefront builds |
| Architecture | Passed: 297 modules / 900 dependencies; private-import check 259 files |
| Migrations 001–029 apply/down/reapply | Passed, including the 029 down-migration refusal when restore history exists |
| Dependency audit | No known vulnerabilities |
| Full browser suite | 97/101; `restore.spec.ts` passed 3/3 in the full run. Failures: the known `online-returns.spec.ts` environment failure and three tests that timed out waiting for the login form (`offline-pos.spec.ts:43`, `offline-sync.spec.ts:372`, `sales.spec.ts:919`) |
| Browser focused recheck | 6/6: those three plus `sales.spec.ts:287`, `sales.spec.ts:513` and `order-confirmation.spec.ts:3`, which failed the same way in earlier full runs |
| Unchanged baseline `6aa2c62`, same environment | Browser 92/98, with the same login-form timeouts in `offline-sync.spec.ts` and `sales.spec.ts` plus `online-returns.spec.ts` |
| `git diff --check` | Passed |

Known issue outside this ticket: five reporting HTTP tests from ticket 23 depend on the real calendar date and fail after 16 September 2026 in Cairo on the committed baseline too. They are recorded for a separate ticket 23 follow-up; ticket 27 does not change reporting.

The unrelated user edit in `docs/reviews/bravos-v1-grok-review.md` is preserved and excluded.

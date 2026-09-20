# Local release rehearsal review

Ticket 28 / GitHub issue #29. Baseline: accepted ticket 27 commit `e51eafd`. A Sol HIGH release lane drafted the tooling from an older base (`bc0e277`); Claude (root) rebuilt only the release work on top of `e51eafd`, ran the rehearsal and the device checks, repaired what they exposed and recorded what cannot be verified here. Independent Standards and Spec reviews ran on 2026-09-20. Actionable P2s were repaired in this candidate; remaining P3s and rehearsal limits are listed below.

## Scope

The slice adds the operator-facing release path and the evidence for it. Production startup now requires an explicit external product-media directory and the `operator-file` owner-recovery adapter, resolves both directories through symlinks and junctions, refuses overlapping or in-repository paths and enforces owner-only permissions. `pnpm release:migrate status|apply` inspects and applies forward migrations under one PostgreSQL advisory lock and refuses unknown, missing or out-of-order history; there is no release rollback command. `pnpm release:bootstrap-owner` creates exactly one owner from a protected password file. `pnpm release:rehearse` supervises the built API, staff app and storefront on loopback with coordinated shutdown, and `BRAVOS_LOOPBACK_REHEARSAL=true` allows insecure cookies only at the fixed `127.0.0.1` origins. Public ordering is gated: `GET /api/public/runtime` reports the gate, quote and order return `503 PUBLIC_ORDERING_DISABLED` while it is closed, and the storefront explains the closure in Arabic and keeps the cart. The API closes gracefully on SIGINT/SIGTERM and on the supervisor's shutdown message. Documentation covers configuration, owner bootstrap and recovery, durable images, the restore procedure, the launch-data checklist, the internal-before-public rollout and the device work that still needs real hardware.

## Rebuild

The draft worktree still carried the whole ticket 22 online-Returns lane. Only release files and release hunks were ported; every stale copy was dropped. The one cosmetic refactor in `resolveMigrationsDir` was reverted so the diff stays release-only. Nothing in the slice changes an existing feature's business behavior except the two repairs below.

## Rehearsal

A full built-artifact rehearsal ran with `NODE_ENV=production` against an external PostgreSQL database, both operator directories outside the repository, and clearly labeled data (every name starts with «تجربة» or `REHEARSAL`). Evidence: `.scratch/claude-ticket28/rehearsal/` (ledger, logs, exports, archives).

- `release:migrate status` → 001–029 pending, `apply`, then `status` → all applied, nothing pending, no drift. `release:bootstrap-owner` created the owner and refused on a second run.
- Ordering closed: `/api/public/runtime` false, quote and order `503`, catalog and storefront browsing still served, no quote or order row written.
- Internal workflow: opening import preview and accept, receiving a second batch at a different cost, a connected cash sale across two FIFO batches, an offline-style accepted sale with a repeated operation id, an expense and its manager correction. Every total matched values computed by hand: revenue 2,700.00, FIFO cost 1,020.00, stock 11 units / 1,700.00, effective expenses 120.00.
- Stop and restart with ordering open: all three processes exited, ports freed, `runtime` true, totals unchanged.
- Public and after-sale workflow: two online orders with a repeated submission, confirmation with set-aside, shipment, delivery, a failed parcel inspected and closed, a physical Return, an exchange, and an online Return. Final figures matched by hand: revenue 3,100.00, refunds paid 700.00, exchange credit 300.00, restored cost 420.00, stock 12 units / 1,720.00, report gross 3,530.00 and operating profit 1,380.00.
- Reports, PDF and Excel exports and analytics returned the expected values and content types.
- Backup and restore: manifest counts equalled decoded rows and live counts for all 86 tables; a write during the pause was refused with `409 RESTORE_PAUSED`; after activation every total was identical and the generation advanced 0 → 1. The same archive also restored into a second fresh database with identical totals.
- Owner recovery wrote `latest.json` into the `0700` recovery directory with mode `0600`; a scan found no token, password or secret in any log.

## Devices

Chromium emulation only (Playwright 1.55.1, Chromium 141): desktop 1366×768 with keyboard, a tablet profile and Pixel 7 / iPhone 13 profiles with touch. Evidence: `.scratch/claude-ticket28/devices/`.

- All 76 page audits are `dir="rtl"`, `lang="ar"`. Staff-app contrast is at or above 5.2:1.
- A cash sale completed with the keyboard alone on desktop and with taps alone on the tablet.
- Production offline path on the tablet: service worker active and controlling, offline reload of the POS, an offline sale queued and synced on reconnect with the unsynced count returning to zero.
- Storefront browse, cart and checkout worked by touch on both phone profiles.

## Repairs

- **Sign-in limiting applied to the whole shop.** In production, Better Auth could not resolve a client address, so every sign-in shared one bucket of three per ten seconds and the fourth staff member was refused; the API also reported that refusal as `401` "يلزم تسجيل الدخول". The API now passes the connection address as `x-bravos-client-ip`, Better Auth reads only that header, so client-supplied forwarding headers cannot shift the bucket, and a limited attempt returns `429 RATE_LIMITED` with an Arabic message. Red first: a production child-process test showed `[200, 200, 200, 401]` for four separate addresses, then `[200, 200, 200, 200]` with the repair and `429` for a fourth attempt from one address.
- **The reports page scrolled sideways on every profile.** A wide table in a grid card widened the page (1411/1366 desktop, 600/412 phone). A scoped rule lets report cards shrink so the table scrolls inside its own wrapper; after the repair every profile is exactly as wide as the screen and the tables scroll in place.

## Open findings, not changed

- **Opening stock is reported as the day's purchases.** The opening-import receipt is dated on the import day while its batches keep the CSV date, so the purchase figure on cutover day showed 2,720.00 instead of 700.00 and 2026-08-01 showed zero. Ticket 28 does not change this. Recommended follow-up (needs owner confirmation): keep the acceptance-dated receiving audit record and per-batch CSV dates for FIFO; exclude or separately label opening-import receipts in the purchases report rather than backdating them. The ticket 23 tests that hard-code 16 September 2026 as today belong in the same follow-up.
- Small touch targets on the reports page links (25.6 px) and on storefront header and breadcrumb links (down to 23.8 px); a missing Arabic message when a required checkout field is empty, where only the browser's own bubble appears; a 3.79:1 placeholder caption for products without an image; staff ids instead of names on the online-order detail line; no visible cue that a report table scrolls.
- The staff app shows Western digits while the storefront shows Arabic-Indic digits.

## Remaining release blockers

1. Physical devices: Safari on iPad and iPhone and Chrome on real Android hardware for sign-in, a cash sale, offline selling, reconnect and sync, on-screen keyboards, native pickers and installed Arabic fonts. Emulation does not settle these.
2. Hosting: HTTPS origins, secure cookies, a reverse proxy and its trusted client address, service units, log retention and monitoring. Trusting a proxy's client address is not implemented, so behind an untrusted proxy every device shares one sign-in limit.
3. Multi-host product media has no shared-storage adapter; one API host with a durable volume is the supported shape.
4. The owner's confirmation of the purchase-date follow-up above.
5. Domain and hosting booking stay deferred by the owner's instruction; nothing here purchases or deploys.

## Acceptance criteria

| Criterion | Status |
| --- | --- |
| 1. Full suites on a fresh migrated database, browser flows, architecture/bundle checks, migration replay, release failures fixed | Met for this slice's gates. Full HTTP 218/223: the five failures are the known ticket 23 date-dependent reporting tests, which also fail on `e51eafd` and are a separate follow-up, not a ticket 28 regression |
| 2. Desktop/tablet/phone Arabic RTL, keyboard and touch, essential offline cache, honest device record | Partly met: emulation passed and is recorded; physical devices remain, listed above and in the rehearsal document |
| 3. Rehearse opening import through backup/restore with labeled data and exact totals | Met; see the ledger |
| 4. Portable configuration, owner bootstrap/recovery, durable images, launch checklist, restore procedure, internal-before-public | Met in `docs/development/release-rehearsal.md` |
| 5. Exclusions, restricted data, operator inputs separated from defects, no untested readiness claim | Met: the launch checklist lists operator inputs, this review lists defects and blockers, and no production readiness is claimed |
| 6. Established gates run and recorded | Met; see below |

## Verification

Environment: a Linux cloud workspace, not Windows. The rehearsal used embedded PostgreSQL as the external database and loopback HTTP; there is no TLS, proxy or hosted evidence.

| Check | Result |
| --- | --- |
| Workspace typecheck | Passed |
| Full HTTP against real PostgreSQL | 218/223 in 28 files. The 5 failures are the known ticket 23 date-dependent reporting tests, which fail on the committed baseline too |
| Full browser suite | 98/101. The known `online-returns.spec.ts` environment failure plus two tests that timed out waiting for the login form; both passed 2/2 on a focused rerun and the same pattern occurs on unchanged baselines in this environment |
| Production builds and bundle separation | Passed: internal 30 files, storefront 161, static entries 3 |
| Architecture | Passed: 299 modules / 908 dependencies; private-import check 260 files |
| Migrations 001–029 apply/down/reapply, failed-migration rollback | Passed, including the new locked-apply and history-drift tests |
| Release commands | `release:migrate status/apply/status`, `release:bootstrap-owner` (and its refusal on a second run), `release:rehearse` start, readiness, coordinated stop and restart with the ordering gate flipped |
| Built-artifact rehearsal totals | Every figure matched an independently hand-computed expectation; see the ledger |
| Sign-in limit repair | Red then green in a production child process |
| Reports overflow repair | Page width equals screen width on all four profiles; tables scroll inside their cards |
| Dependency audit | No known vulnerabilities (run at ticket 27; no dependency changed in this slice) |
| `git diff --check` | Passed |

## Independent review

Standards: no P1. One P2 — recovery tests did not assert the owner-only permission contract — repaired with POSIX mode and Windows ACL assertions after `deliver`, plus `protectOperatorSecretFile` coverage for relative, in-repo, directory, and (non-Windows) symlink paths. Windows verification of that adapter also exposed two real defects, both repaired: short 8.3 temp paths were treated as a directory swap, and `powershell.exe` inherited PowerShell 7's `PSModulePath` then `Set-Acl` demanded `SeSecurityPrivilege`. Deliver now pins the first real path, clears `PSModulePath` for Windows PowerShell 5.1, and writes a current-user-only DACL through .NET `SetAccessControl`. Accepted P3s: duplicated directory-prepare and drift-guard helpers were not extracted (no architecture refactor in this slice); `bootstrap-owner` still reads the owner uniqueness index through SQL, matching `setup-local.ts`, with `staff_profile_one_owner` as the real constraint. One lock-release leak on failed `pg_advisory_unlock` was repaired so the pooled client is destroyed instead of returned with the session lock held.

Spec: no P1. Closed-ordering Arabic UI and retained cart were HTTP-only; a focused Playwright case now covers the closure screen and cart. Restore owner-recovery completion after a fresh database is already proven in ticket 27 HTTP (`restore.test.ts` `recoverOwner`) and was not repeated as a second rehearsal drill. Criterion 1 now names the five known ticket 23 date-dependent HTTP failures instead of saying Met without that qualifier. No scope creep: the sign-in 429 and reports overflow repairs are rehearsal-found failures under this ticket.

## Open work

Owner confirmation of the purchase-date follow-up, physical-device checks, and hosted TLS/proxy remain outside this candidate. This slice is not committed until that confirmation.

The unrelated user edit in `docs/reviews/bravos-v1-grok-review.md` is preserved and excluded.

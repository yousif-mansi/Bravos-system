# Staff-access repair review

Final disposition, 2026-09-10 (Cairo): **accepted for ticket01 local development**. All actionable Standards and Spec findings below were corrected and rechecked. The orchestrator independently passed typecheck,26 real PostgreSQL HTTP tests, all builds, architecture after build, migration apply/down/reapply/rollback,4 browser flows, and dependency audit with zero advisories. Grok additionally demonstrated fresh/repeated isolated setup and compiled API health. The public storefront remains a placeholder; later tickets and production release are not claimed complete.

Final corrections include explicit source-output exclusions that retain SDK dependency edges, a valid npm JavaScript CLI bootstrap, first-time browser installation instructions, verification-only setup-root documentation, and credential-file preservation on unexpected auth errors. Root added the generated TypeScript cache to ignore rules while curating the commit. The remaining narrative is the historical review/repair record, not a list of open findings.

Date: 2026-09-09. Independent read-only reviews of Grok's repaired, uncommitted ticket01/issue#2 draft against baseline `c4983ec`. Application files remain untracked, so reviewers inspected their contents as well as the tracked diff. This is an interim review, not acceptance. No application gates had passed at review time. Follow-up corrections were delegated through `.scratch/grok-implementation/2026-09-09-corrections.md`.

## Standards

- **P2 — Authentication responses expose provider session material.** `apps/api/src/app.ts` removes selected fields but forwards all others. The installed Better Auth username handler returns `token: session.token`, which survives this filter. The specification requires safe contracts and secure session handling. Use explicit login/session DTOs and verify that cookies authenticate without returning tokens in JSON.
- **P2 — Migration transactions lack connection affinity.** `packages/persistence/src/migrate.ts` sends BEGIN, migration SQL, bookkeeping and COMMIT through separate `pool.query` calls. Those statements need one acquired connection to form a transaction. Use a checked-out client with rollback/release and a real PostgreSQL failure case.
- **P2 — Negative authentication assertions accept server failures.** `tests/http/staff-access.test.ts` accepts any status at least400 for several authentication/recovery rejections. A500 can therefore satisfy a security assertion. Assert the expected client-error contract and actual subsequent business behavior.
- **Heuristic: possible speculative generality.** `saveProfile` remains an unused alternative write path, and `parseGrantInput` is publicly exported despite having only an internal caller. Remove unnecessary public surface.

Earlier unrestricted provider routing, HTTP Headers in use cases, and domain-generated provider emails were fixed in the inspected draft. No mocked or skipped business tests were found. Standards: three documented findings and one heuristic concern; highest priority P2.

## Spec

- **P2 — Documented startup misses its generated environment.** The ticket requires documented setup that starts the shared API. `apps/api/src/load-env.ts` resolves `.local/dev.env` relative to the package working directory, while setup writes it at workspace root. Verify both development and built startup from their documented commands.
- **P2 — Concurrent grant replacement can retain unintended permissions.** The ticket requires current authorized grants. `packages/identity/src/adapters/postgres-directory.ts` deletes/inserts grants without serializing changes to that staff member. Overlapping replacements can leave a union of two submitted sets. Lock the staff record before replacement and verify competing updates/revocation through HTTP.
- **P2 — Earlier action attribution is overwritten.** Story10 requires important operations to retain actor/time. `recordChangeOn` only updates last-changed fields, losing previous reset, disablement and permission-change attribution. Retain a minimal operation record with each successful mutation; a separate audit UI is unnecessary.
- **P2 — The new browser flow uses ambiguous locators.** The ticket requires a real-browser provisioning/login workflow. Non-exact branch checkbox names also match capability checkboxes. Scope to the appropriate form and use exact accessible names; verify the whole workflow in a browser.

Spec: four findings; highest priority P2. All findings concern mutable work and must be rechecked after correction.

## Orchestrator additions and acceptance gate

- Replace Next15.5.3: it is below the [August2026 security patch releases](https://nextjs.org/blog/august-2026-security-release). Verify supported patched versions and the complete dependency graph. The second install completed downloads but rejected Vite8.2.2 with React-plugin5.0.4 because of incompatible peers; do not disable that check.
- Serialize distinct valid recovery tokens at the owner boundary to avoid competing redemptions deadlocking. Verify same-token and distinct-token races, expiry, outstanding-token invalidation and session revocation.
- Ensure local setup closes its pool/PostgreSQL on failure and preserves accurate credentials on repetition.
- Required acceptance remains actual typecheck, import/cycle checks, authenticated HTTP tests with real PostgreSQL, real-browser gateway/UI tests, builds and executable API startup, and migration apply/down/reapply. No retrospective red-before-green claim is supported for code written before dependency installation.
- Preserve the separate existing user edit in `docs/reviews/bravos-v1-grok-review.md`; it is not part of this repair.

## Run3 recheck

Both independent reviewers rechecked source corrections. The four Spec findings are resolved in source. Standards confirmed explicit safe auth DTOs, a dedicated migration transaction client, and removal of the unused public surface. Recovery races have real PostgreSQL HTTP coverage. Grok's HTTP run passed20 tests and its migration round-trip passed; the orchestrator independently passed typecheck and architecture. Runtime acceptance remains pending.

Remaining corrections delegated in run4:

- The rollback test manually constructs its own transaction instead of exercising the production migration runner. Run an intentionally failing temporary migration through the actual runner and verify both schema and bookkeeping rollback.
- Three old-password/disabled-login/signup assertions still accept500; require the expected client-error contract.
- Independent pnpm audit after Next16.3.4 reports14 advisories:1critical,5high,7moderate,1low across Fastify, Vite, Vitest and its mocker dependency. Verify compatible patched pins and the final dependency graph.
- Production `index-DdKgUkZl.js` statically imports `staff-management-CnjDV9Wu.js`. Removing its preload link made the current check pass but did not prevent eager loading. Fix chunk ownership and verify the static import graph and real production-login network behavior.
- Repeated local setup printed success but emitted ECONNRESET/connection-termination errors. Verify complete lifecycle cleanup and executable API startup. Run3 reached its watchdog during browser startup after installing the required binaries; it did not finish browser verification or provide a successful final report.

Status: source repairs substantially improve the draft, but these corrections and independent final runtime checks are required before acceptance or commit.

Focused lifecycle recheck additionally found initialization failures can leave the API pool open, shutdown failures skip later cleanup, and Better Auth's asynchronous initialization/schema check can outlive repeated setup. Suppressing connection errors is not a cleanup fix. Existing-account setup must also verify a supplied password before recording it and match preserved credentials to the same login. These corrections are included in the fresh run5 brief. Independent HTTP verification now passes20 tests; independent browser verification failed at webserver readiness before running tests.

## Run5 recheck (2026-09-10 Cairo)

The independent focused reviewer confirmed initialization validation and cleanup, nested shutdown cleanup, waiting for Better Auth's cached schema-check promise, verified same-login credentials, and the actual migration-runner rollback regression are resolved in source. Grok ran the new migration and three credential tests successfully against real PostgreSQL. One remaining credential defect was sent to run6: unexpected authentication errors must abort verification without replacing preserved credentials with an unknown value.

After installing compatible patched dependencies, the orchestrator's independent `pnpm audit --json` reported zero advisories in every severity category. Browser startup was changed to explicit loopback addresses and pinned process environments; actual browser success and final complete gate reruns remain pending. Run5 reached its30-minute watchdog during the full suite; run6 continues verification rather than constituting acceptance.

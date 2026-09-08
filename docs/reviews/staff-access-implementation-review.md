# Staff-access implementation review

Date: 2026-09-08. Static review of Grok's uncommitted first-slice code against planning baseline `3918ce5` and [implementation ticket #2](https://github.com/yousif-mansi/Bravos-system/issues/2). The specification and ticket publication are complete; this application slice is not. No dependency installation, application test, browser test, migration round-trip or build has passed.

Two independent code-review agents reviewed Standards and Spec separately. The orchestrator inspected the same files and supplied the main corrections to Grok's resume brief. That resumed session produced no tool calls or text before being stopped for connectivity failure, so these corrections remain outstanding. Recheck the exact current code before implementing fixes.

## Standards

1. **P1 — Provider routes bypass the intended identity boundary.** The API forwards every authentication GET/POST to Better Auth while its admin plugin is enabled. This exposes provider operations outside the application's staff/grant/owner checks. The approved specification requires gateways to expose only permitted operations. Allowlist necessary authentication operations and return safe responses. Relevant sources: `apps/api/src/app.ts`, `packages/identity/src/adapters/better-auth-provider.ts`.
2. **P2 — HTTP transport leaks into application use cases.** Identity application methods and the identity-provider port accept Web `Headers`. Architecture principle 1 requires application use cases independent of delivery protocols. Resolve authentication through the transport adapter and pass a transport-neutral, server-verified identity context. Relevant sources: `packages/identity/src/application/staff.ts` and `ports.ts`.
3. **P2 — Provider-specific identity mapping belongs in the adapter.** Application code generates the internal email-shaped identifier through a domain helper, although the specification assigns this Better Auth requirement to the identity adapter. Move mapping into that adapter rather than making a provider's email requirement part of business logic. Relevant sources: `packages/identity/src/application/staff.ts`, `domain/login-name.ts`.
4. **Heuristic: possible speculative generality.** Unused `enableAccount`, `getBranch`, alternative authorization assertions and the public recovery hashing export enlarge interfaces without current callers. Remove unused surface and retain one authorization approach. This is a judgment call, separate from documented-standard breaches.

The HTTP tests predominantly use the agreed public boundary with real adapters/database; observed database reads were fixture setup rather than business-result assertions. They could not be run.

## Spec

1. **P1 — Recovery token can reset the password twice concurrently.** The ticket requires recovery endpoints that do not allow account takeover. Completion reads an unused challenge, changes the password, then consumes it without checking whether another request won. Claim redemption atomically, invalidate outstanding challenges appropriately and test concurrent/replayed redemption. Relevant source: `packages/identity/src/application/staff.ts`.
2. **P2 — Manager cannot assign both branches through the UI.** The ticket requires one or both configured branches. Staff creation sends one grant from a single select, and existing accounts have no grant editor. Provide branch-specific selections/capabilities and verify two-branch creation and updates. Relevant source: `apps/internal/src/pages/StaffPage.tsx`.
3. **P2 — Raw authentication routes bypass staff-management rules.** Forwarded provider administration can bypass application provisioning/grant and owner-protection checks. Restrict forwarding to required session/login operations and test denied administrative paths. Relevant sources: `apps/api/src/app.ts`, `packages/identity/src/adapters/better-auth-provider.ts`.
4. **P2 — Repeat setup replaces working credential instructions with incorrect passwords.** Setup suppresses duplicate-account errors after generating new passwords, then overwrites the credentials file without updating existing accounts. Preserve existing credentials or explicitly report that their passwords remain unchanged. Relevant source: `scripts/setup-local.ts`.
5. **P2 — API build cannot produce its advertised start target.** Build uses `--noEmit`, but start expects `dist/main.js`. Produce a runnable artifact and actually verify starting it. Relevant source: `apps/api/package.json`.
6. **P2 — Staff changes lose actor attribution.** Story 10 requires important operations to retain responsible user and time. Provisioning, reset, disable and grant replacement discard the authenticated manager after authorization and retain no initiating actor record. Persist attribution with each successful mutation. Relevant source: `packages/identity/src/application/staff.ts`.

Standards: three documented breaches plus one heuristic concern; worst priority P1 for provider-route exposure. Spec: six findings; worst priority P1 for recovery-token concurrency. Counts remain separate because the axes overlap.

## Orchestrator checks still required

- Correct malformed-grant validation and atomic provisioning/grant replacement; prove failure does not leave partial identity records.
- Replace the unmasked password-reset prompt, handle workspace-refresh failures visibly and verify active-branch/account isolation.
- Restore portable dependency manifests and one reproducible pnpm lockfile; current ignored tarball references are temporary diagnostics.
- Verify genuine migration apply/down/reapply, fresh and repeated local setup, real PostgreSQL HTTP behavior, real-browser gateway/cookie behavior, architecture enforcement and actual builds.
- Keep implementation status honest: the initial run wrote tests before production files but never executed a failing test first. Subsequent regression fixes should record actual red/green evidence; they cannot retroactively prove the initial TDD sequence.

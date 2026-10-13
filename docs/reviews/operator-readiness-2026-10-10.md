# Operator readiness — prepared 11 October 2026

This pass adds one API failure diagnostic and blank operator records. It is not production readiness, launch acceptance, or a completed pilot. The filename keeps the queue date 2026-10-10. Execution was 11 October 2026, local offset +03:00.

Source stayed on `codex/readiness-issue-reconciliation` at `2a59cdab860dced680944ae5fbb042498eabc1e8`. No stage, commit, push, merge, or deployment. The main-owned execution plan and `docs/reviews/bravos-v1-grok-review.md` were already dirty and were not edited. The protected review SHA-256 remains `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

## What changed

| File | Reason |
| --- | --- |
| `apps/api/src/app.ts` | One `console.error` on the existing generic 500 branch of `sendError`, after every known domain 4xx branch. |
| `tests/http/catalog.test.ts` | One real-PostgreSQL HTTP regression through the existing catalog harness. |
| `docs/development/operator-pilot-acceptance.md` | New blank pilot record. Execution and sign-off are empty. |
| `docs/development/operator-handover.md` | Arabic pointer to that record, the diagnostic limit, and the health-liveness limit. |
| `docs/development/release-rehearsal.md` | Host-neutral future checks, the same diagnostic limit, and links to the record and failed-release checklist. |
| `docs/development/backups/restore.md` | Failed-release checklist distinguishing external PostgreSQL recovery from merge restore. |
| `docs/reviews/operator-readiness-2026-10-10.md` | This evidence record. |

`git diff --stat` for the five tracked edits, before this report existed: `apps/api/src/app.ts` +7, `tests/http/catalog.test.ts` +96/−1, `docs/development/backups/restore.md` +22, `docs/development/operator-handover.md` +10/−1, `docs/development/release-rehearsal.md` +26/−1. The acceptance record is untracked. No schema, route, permission, pricing, stock, ordering, or restore-architecture change.

The only application change is the final branch of `sendError`:

```ts
const requestId = reply.request.id;
const routeTemplate = reply.request.routeOptions.url;
console.error("api.unexpected_failure", {
  category: "unexpected_operation_failure",
  requestId: typeof requestId === "string" ? requestId : "unavailable",
  routeTemplate: typeof routeTemplate === "string" && routeTemplate.length > 0 ? routeTemplate : "unmatched",
});
return reply.status(500).send(errorBody("CONFLICT", "تعذر إكمال العملية."));
```

Fastify stays `logger: false`. There is still no custom `setErrorHandler`. A non-string id or a missing route template is replaced by the static fallback `unavailable` or `unmatched`. The error object is not passed.

## Diagnostic privacy

The new line covers unexpected failures that reach `handle` / `sendError` and miss every known 4xx branch. It records the static event `api.unexpected_failure`, the static category `unexpected_operation_failure`, Fastify's generated request id, and `routeOptions.url`.

It does not cover every server log. These existing paths are unchanged and are not a sanitized-diagnostic guarantee:

- PostgreSQL pool and lifecycle errors still go through `sanitizePoolError`, which keeps the error name and message and redacts a `postgres://` userinfo.
- The auth-proxy 500 in `forwardAuth` still returns the same Arabic body and does not call `sendError`.
- Fastify parser failures and unmatched routes do not go through this branch.

Known domain 401, 403, 400, 404, and 409 responses return before the new line.

## Regression

Command, from the repository root, Node v22.23.3 and pnpm 10.34.5:

`pnpm exec vitest run --config vitest.config.ts tests/http/catalog.test.ts -t "unexpected catalog failure"`

Started `2026-10-11T00:18:52.3749141+03:00`, Vitest 4.1.11 started 00:18:56, duration 24.93s, ended `2026-10-11T00:19:21.8043531+03:00`. Exit 0. Test files 1 passed. Tests 1 passed and 16 skipped (17). No red run and no rerun. Log: `.scratch/operator-readiness-2026-10-10/http-diagnostic.log`.

The test uses the catalog harness on port 55438. `startApp` builds a fresh app before any injection. The test then registers an `onRequest` observer that stores only `request.id`, replaces `built.catalog.getPublicProduct` with a `DO` / `RAISE` on that harness database, and restores both spies in `finally`. The raised message, detail, and hint carry synthetic sentinels, including a connection URL and password. The request also sends sentinel request-id headers, a path parameter, a query, a cookie, and a bearer token.

The passing assertions were: HTTP 500 with exactly `{ error: { code: "CONFLICT", messageAr: "تعذر إكمال العملية." } }`; one `console.error` call; metadata exactly the static category, the observed `req-…` id, and `/api/public/catalog/products/:productId`; no `request-id` or `x-request-id` response header; the generated id absent from the body; every sentinel absent from the body, headers, and diagnostic. A later 401 `UNAUTHENTICATED`, 400 `VALIDATION`, and 404 `NOT_FOUND` left the call count at one.

No production process was faulted. Ordinary PostgreSQL on 54329 remained pid 25840. After the test, port 55438 was free. API 3010, staff 5173, and storefront 3000 stayed stopped.

## Other gates

Log: `.scratch/operator-readiness-2026-10-10/gates.log`. Each command exited 0 on its first run. The shell printed a `NO_COLOR` / `FORCE_COLOR` warning; it did not change the exits.

| Gate | Command | Window (+03:00) | Exit |
| --- | --- | --- | --- |
| Typecheck | `pnpm typecheck` | 00:19:41.161 to 00:20:28.411 | 0 |
| Architecture | `pnpm check:architecture` | 00:20:28.415 to 00:20:35.374 | 0 |
| API build | `pnpm --filter @bravos/api build` | 00:20:35.377 to 00:20:37.715 | 0 |
| Diff check | `git diff --check` | 00:20:37.717 to 00:20:37.882 | 0 |
| Scoped diff check | `git diff --check --` the five tracked files above | 00:20:37.886 to 00:20:37.972 | 0 |

Architecture reported no dependency violations (444 modules, 1063 dependencies) and `private-import check passed (385 files)`. The API build wrote gitignored `apps/api/dist/main.js` (1.2mb) and its map. `git diff --check` also printed the existing CRLF notice for `apps/api/src/app.ts` and still exited 0. A later diff check that includes this report is appended to the same log.

## Prepared records

These are procedures and blank fields, not drill results.

- [Operator pilot acceptance record](../development/operator-pilot-acceptance.md): source/build, operator, backup, media copy, fixture, Cairo date, device, and browser are blank. Six scenarios have the accepted expected result only: cash / manual online / split tender; offline sale, reconnect, and queue; whole-order single-branch confirmation and reversal; a sellable return received at the other branch with original cost and sale attribution; encrypted business backup plus a separate media copy; fresh-target restore, owner recovery, and queued sales once. Actual, evidence, blocker, and sign-off are blank.
- [Release rehearsal — availability checks](../development/release-rehearsal.md#availability-checks): public health is API liveness, not database, staff, storefront, recovery, or commerce proof. Future checks are API, staff, and public availability, PostgreSQL, the protected recovery path, disk and media, retained service and proxy logs, backup and media age, and incident ownership. Host, interval, retention, and alert destination stay deferred. No hosting topology is chosen.
- [Failed-release recovery](../development/backups/restore.md#failed-release-recovery): an externally verified PostgreSQL restore uses the host's procedure after the owner supplies the host and a verified backup. The application merge cannot undo an activation in place. The checklist has no drop, restore, or overwrite command. Its boxes are unchecked.

## Still unexecuted

Main's document review added a blank backup-operator field, explicitly retained the failed-delivery inspection boundary and 14-day/actual-paid refund workflow, and limited automatic retained-sale recovery to supported cases in the existing restore guide. No business policy or application behavior changed. Main's independent full catalog HTTP verification and final coherence results are recorded separately after Grok's handoff; the focused 1-pass/16-filtered-out result above is not a full catalog pass.

Independent main verification passed the **complete catalog file: 17 tests, no skips**, followed serially by typecheck, architecture, API build, and diff/source/protected-file checks, all exit0. Logs and exact commands/timestamps are under `.scratch/grok-production-20261010/operator-main-verification/`. The source was frozen for that cycle and unchanged at its end; the protected hash remained exact, isolated processes/listeners were absent, and ordinary PostgreSQL remained running. The small record clarification and this evidence update were applied after the checks ended. Main reviewed the final API/test diff: seven API lines only, no new handler, response header, dependency, route, schema, permission or business-rule change. Full-project and matching hosted acceptance are separate gates recorded on [PR43](https://github.com/yousif-mansi/Bravos-system/pull/43); this bounded record does not imply their results.

Real devices and browsers, the pilot sign-off, merchandise content, hosting and domain, monitor intervals and alert destinations, an external backup drill, an application restore drill, `release:rehearse`, any production process start, the full HTTP suite, the browser suite, and hosted CI. This pass does not accept a launch.

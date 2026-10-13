# Production configuration guard — 13 October 2026

Bounded task 02 on `codex/readiness-issue-reconciliation` at `f7507e20f5162987644f424d5a61865828a27e41`. Source hardening of the `loadConfig` startup boundary only. This is not hosted acceptance, secret-randomness proof, launch approval, a production start, or a public-ordering change.

## Outcome

**Implemented.** Production, including the explicit local loopback rehearsal, now fail-fasts in `loadConfig` before `buildApp`, pools, or migrations:

- `BETTER_AUTH_SECRET` must be present, not whitespace-only, at least 32 characters, not the installed Better Auth 1.7.3 public default (`better-auth-secret-12345678901234567890`), and not the exact committed example placeholders (`replace-with-a-long-local-secret`, `replace-with-a-long-random-secret`). The accepted value is stored verbatim. Errors name the variable and requirement and do not print the secret.
- Hosted production requires explicit `BRAVOS_INTERNAL_ORIGIN`, `BRAVOS_PUBLIC_ORIGIN`, and an auth origin selected through existing `BETTER_AUTH_URL` then `BRAVOS_API_ORIGIN` precedence. Each must be a canonical literal HTTPS origin (`https`, no userinfo, path, query, fragment, or wildcard hostname; the configured string must equal `URL.origin`). Missing, empty, malformed, non-HTTPS, and noncanonical strings are rejected rather than defaulted or normalized.
- The existing production-only fixed HTTP loopback rehearsal is unchanged: `http://127.0.0.1:3010`, `http://127.0.0.1:5173`, `http://127.0.0.1:3000`, no extra trusted origins, insecure cookies, secret validation still applied. Development and test keep HTTP loopback defaults and nonempty-secret behavior.

Length and placeholder checks are not proof of randomness. The operator still must cryptographically generate and manage the real secret. Hostname and port remain operator-owned. `BRAVOS_TRUSTED_ORIGINS` parsing is unchanged. Direct `AppConfig` fixtures and `buildApp` validation were not altered.

## 1. Weakness and guard

Confirmed loader weakness: `required(BETTER_AUTH_SECRET)` accepted any nonempty string, and production origins silently defaulted to HTTP loopback. Installed Better Auth 1.7.3 rejects only its public default in production and otherwise warns for short or low-entropy secrets; it accepts HTTP URL schemes. No deployed secret was inspected.

The guard lives only in `apps/api/src/config.ts`. `main.ts` already calls `loadConfig()` before `buildApp`. No app, pool, migration, contract, schema, dependency, script, staff-access, env-example, or frontend change was required.

## 2. Changed files

| File | Why |
| --- | --- |
| `apps/api/src/config.ts` | Production secret and canonical HTTPS origin fail-fast; rehearsal and dev/test defaults preserved |
| `tests/http/config.test.ts` | **New.** Pure loader boundary regressions |
| `tests/http/checkout.test.ts` | Existing production fixture only: explicit HTTPS origins for hosted checks, separate exact loopback fixture for rehearsal, otherwise-valid origins on the missing-media case |
| `docs/development/release-rehearsal.md` | Document the startup boundary without claiming launch acceptance |
| `docs/reviews/production-config-guard-2026-10-13.md` | This report |

**New files created:** `tests/http/config.test.ts`, `docs/reviews/production-config-guard-2026-10-13.md`, and ignored logs under `.scratch/ux-completion-20261013/task-02/`.

Staff-access tests, `tests/http/fixtures/production-sign-in-limit.ts`, `app.ts`, `main.ts`, env examples, and business modules were not modified. Existing production test secrets (34/38/38/38 characters) were left unchanged.

## 3. Gates

Pinned Node `v22.23.3` (`.local/tools/node-v22.23.3-win-x64/node.exe`) and pnpm `10.34.5` (`.local/tools/node_modules/pnpm/bin/pnpm.cjs`). `COREPACK_ENABLE_AUTO_PIN=0`. PATH: `.local/tools/node_modules/.bin` then the pinned Node directory.

Before HTTP tests, port **55456** (checkout default) had an unrelated Chrome outbound ephemeral connection, with no checkout PostgreSQL listener. Port **55432** (staff-access) was free. Chrome was left untouched and no test port was changed. The checkout cluster bound successfully; 36/36 HTTP tests passed. After teardown, the isolated PostgreSQL listeners were closed; Chrome's unrelated connection remained.

| Run | Command | Result | Exit | Log |
| --- | --- | --- | --- | --- |
| Config loader (red) | `pnpm exec vitest run --config vitest.config.ts tests/http/config.test.ts` | 1 failed / 6 passed (verbatim secret fixture was 31 characters) | **1** | `vitest-config-1.log` |
| Config loader (rerun) | same | **7 passed** (1 file) | **0** | `vitest-config-2.log` |
| HTTP | `pnpm exec vitest run --config vitest.config.ts tests/http/checkout.test.ts tests/http/staff-access.test.ts` | **36 passed** (2 files; 9 checkout + 27 staff-access including the Windows recovery ACL case) | **0** | `vitest-http-1.log` |
| Typecheck | `pnpm typecheck` | 23 workspace projects Done, including `apps/api` | **0** | `typecheck-1.log` |
| Architecture | `pnpm check:architecture` | 444 modules, 1063 dependencies; private-import 385 files | **0** | `architecture-1.log` |
| Build + bundle guard | `pnpm build` | API + internal + storefront + `bundle separation ok: internal files=34, storefront files=73, static entry files=3` | **0** | `build-1.log` |

The red config run is retained beside the green rerun. The first verbatim-secret fixture used a 31-character string (`  ` + `accepted-production-secret-32`); the rerun uses the 32-character `"  accepted-production-secret-val"` and asserts the leading spaces are kept.

## 4. Compatibility preserved

- Development and `NODE_ENV=test` still default to HTTP loopback origins, default-open public ordering, insecure cookies unless `BRAVOS_SECURE_COOKIES=true`, and nonempty (including short or example) secrets.
- Hosted production still defaults public ordering closed and secure cookies on; `BRAVOS_SECURE_COOKIES=false` does not disable them outside rehearsal.
- Rehearsal still refuses non-production, localhost, other ports/hosts, extra trusted origins, and malformed booleans; omitted origins still default to the three fixed loopback URLs when the flag is true.
- `BRAVOS_TRUSTED_ORIGINS` still splits, trims, filters, and deduplicates, including wildcard extra values; public origin is still not auto-inserted.
- `BRAVOS_PRODUCT_MEDIA_DIR` remains required in production, including rehearsal.
- Direct `buildApp` HTTPS staff fixtures and the production sign-in child HTTP `AppConfig` fixture were left intact.

## 5. Cleanup and protected state

- `apps/storefront/next-env.d.ts` churned during `next build` (`1862AC4B…` vs saved `0F706298…`) and was restored to the exact saved 296 bytes / `0F70629890B72A0A82E91972CC032C04B658B26C265373CB711CF576BFBF8FCC`.
- `apps/storefront/tsconfig.json` was unchanged at `C347427786B19C87BBF31109DD92C04AF9B2B9F19C9DB1026BE6F5C8802D0A5E`.
- Protected `docs/reviews/bravos-v1-grok-review.md` SHA256 remains `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.
- HEAD `f7507e20f5162987644f424d5a61865828a27e41`, branch `codex/readiness-issue-reconciliation`, index empty. No add, commit, push, or GitHub change.
- Owned isolated Postgres on 55432 was stopped by existing harness teardown. Ordinary listeners were not started. No leftover owned process on 55432/3011/3001/5174/55433/3010/5173/3000.
- Preexisting dirt left in place, including the modified protected review, untracked 11 October audit, task 01 header QA report, fonts, `.pnpm-store`, and `apps/api/.local`.

## 6. Remaining acceptance

This task does not rotate or configure secrets, start production, open public ordering, select a host, proxy, domain, TLS certificate, or device matrix, or prove that an operator-generated secret is random. Rehearsal HTTP remains an explicit local exception with no TLS evidence. Hosted launch still needs operator-owned HTTPS origins, a cryptographically generated secret, reverse proxy, durable storage, monitoring, and the remaining tasks in the 13 October remaining-work queue.

## Main independent review and acceptance

Main and a read-only Sol High reviewer examined the actual loader/test diff. No blocking implementation finding remained after Grok corrected the 31-character test fixture. Existing checkout assertions, authentication behavior, trusted-origin parsing and the fixed rehearsal boundary remain intact.

After Grok's process exited, main ran a fresh serial verification cycle on the uncommitted task02 source: **43 tests passed across three files** (seven pure loader cases plus36 existing checkout/staff tests), typecheck, architecture and all-three-app build/bundle guard. Every gate exited0. Exact commands, UTC completions and numerical exits are in `.scratch/ux-completion-20261013/task-02-main/results.json`; complete logs are adjacent. This is a bounded current-source verification, not a fresh full247-HTTP/162-browser matrix or hosted CI run.

Generated Next files were restored to saved bytes; diff check passed, index remains empty, protected hash matches and isolated listeners are closed. Main accepts task02 as source hardening. No secret rotation, environment-file change, production startup, migration on business data, deployment or GitHub mutation occurred.

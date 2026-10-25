# PR #45 security dependency repair — 25 October 2026

This is a bounded dependency repair following the owner's explicit approval. It does not approve merging, deployment, or production launch.

Update: the approved follow-up below supersedes the remaining-low-advisory and pending-browser entries at the original publication checkpoint. Original failures remain recorded.

## Trigger and scope

Windows CI run [40192586911](https://github.com/yousif-mansi/Bravos-system/actions/runs/40192586911), at `ad973dc39c6d85885f6fdc8eabaca1995fa2c6c4`, passed locked installation but failed its production dependency audit: 13 advisories (2 critical, 2 high, 4 moderate, 5 low). Later static/build steps and the HTTP/browser jobs were skipped. A local audit reproduced that result. Earlier clean audits remain historical evidence.

Grok prepared the repair in the existing isolated checkout at `ad973dc`; the main agent installed and verified it there. A separate read-only Sol review found no blocking dependency or compatibility issue. No application implementation, API, database migration, route, permission, business rule, fixture, test hook, or CI setting was changed.

| File | Reason |
| --- | --- |
| `apps/storefront/package.json` | Next.js 16.3.8 → 16.4.1. |
| `apps/api/package.json` | Fastify 5.12.5 → 5.12.6. |
| `package.json` | Targeted overrides: Zod 4.6.6; fast-uri 3.1.9 and 4.2.3, preserving the two existing major lines. |
| `pnpm-lock.yaml` | Lock those replacements, their required Next.js package family and affected peer snapshot identities. |
| This report | Record the original failure, reviewed scope, current evidence and limits. |

Node 22.23.3, pnpm 10.34.5, React 19.2.8, better-auth 1.7.3, Vite 7.3.7 and Vitest 4.1.12 remain unchanged. Cross-platform optional package metadata in the lockfile is normal resolver output; all execution in this repair was on Windows.

## Main-agent verification

Commands used the pinned Node/pnpm executables and isolated checkout. Heavy commands ran serially after the existing 3 GB physical / 4 GB virtual free-memory guard passed.

| Check | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; the live preview's installed dependencies were not replaced. |
| `pnpm audit --prod --json` | Passed: zero advisories at every severity. |
| `pnpm audit --json` | Exit 1: one low-severity development/build-tool advisory; see below. |
| `pnpm typecheck` | Passed across 23 workspace projects, excluding the root. |
| `pnpm build` | Passed API, internal Vite/PWA and Next.js 16.4.1 production builds, plus bundle separation. |
| Focused HTTP integration | Passed: 3 files / 38 tests (`staff-access`, `storefront`, `checkout`) against isolated PostgreSQL. |
| Production browser integration | Pending; free virtual memory fell below the unchanged guard before launch. No browser result is claimed. |
| Independent dependency review | No blocking finding; registry integrity, consumer ranges and retained peer compatibility checked. |
| `git diff --check` | Passed for the dependency patch. |

Local evidence is under `.scratch/security-dependency-20261025/` in the isolated checkout: `main-install.log`, `main-audit-prod.json`, `main-audit-full.json`, `main-typecheck.log`, `main-build.log`, `main-http.log`, and `independent-review.md`. These ignored artifacts are not part of the commit.

The planned focused browser run uses the built production server, not Next.js development mode: existing staff-access, catalog-media, checkout and checkout-recovery specifications with an ignored configuration overlay. It retains the normal isolated PostgreSQL/API/staff lifecycle, uses explicit checkout working directories, and points Next.js at that test API. It never targets the practice database.

## Remaining low advisory

The full audit reports [`serialize-javascript` < 7.1.3, GHSA-m5mm-p8h7-m29v](https://github.com/advisories/GHSA-m5mm-p8h7-m29v), through `vite-plugin-pwa → workbox-build → @rollup/plugin-terser`. The approved Next/Fastify/Zod/fast-uri repair does not include that separate build-tool patch. No advisory ignore, audit threshold change, or check bypass was introduced. A clean production audit does not mean the full audit is clean.

No exploitation of Bravos was demonstrated. In particular, the Next.js image advisory's Linux/glibc applicability is not evidence of a Windows exploit. This repair resolves the audited locked versions without claiming a demonstrated attack.

## Publication and exclusions

The new PR-head Windows CI remains required; the failed run at `ad973dc` is not converted into a pass by local evidence. Hosted results should be read at the exact replacement commit.

Generated `next-env.d.ts`, browser overlays, screenshots, logs, temporary files, caches, user font/assets and the protected review file are excluded. No unfinished experimental application code or fake production data is included. The protected review's SHA256 remains `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

The ordinary practice stack and its business data were preserved. Its running processes retain their installed pre-repair dependencies until a separate controlled restart; isolated verification must not be presented as an upgrade of the live local preview.

## Approved Windows CI follow-up

The owner approved the three additional fixes after commit `a5c1938`. Windows run [40221238572](https://github.com/yousif-mansi/Bravos-system/actions/runs/40221238572) passed the complete static/build job. Its HTTP job reported 30 failed files / 4 passed files, with 16 passed and 244 skipped tests: native PostgreSQL rejected the administrative runner account during setup. The browser job failed before tests for the same native startup reason. These results are not application acceptance failures or successful suite runs.

The isolated production-browser run started Next.js 16.4.1 successfully and finished 14 passed / 1 failed. The media test encountered a detached category rail; an unchanged one-file retry encountered transient duplicate rail matches. A separate ignored diagnostic with stable unique/visible rail waits passed. Neither retry replaces the recorded original result.

Grok implemented these approved changes; the main agent reviewed and verified them:

- `scripts/run-windows-restricted.ps1`: Windows CI launcher using a restricted current-user token, disabled administrative groups/privileges, explicit argument quoting, inherited environment/output and exact exit propagation. A private job owns the child tree and terminates only its descendants. Token default-DACL handling retains existing entries and current-user access; it does not alter accounts, the original token, filesystem ACLs, or application permissions. Startup fails closed. This is a test launcher, not a general sandbox for untrusted code.
- `.github/workflows/ci.yml`: only the two database-suite commands use that launcher; each first runs `scripts/windows-postgres-smoke.ts`. Existing Windows runner, runtime pins, audits, suite selection, permissions and timeouts are retained. A focused native launcher test step is added.
- `tests/scripts/windows-restricted-runner.test.mjs` and four narrowly scoped fixtures: actual argument/cwd/environment/output/exit behavior, malformed and NUL argument rejection, preserved user identity with disabled administrative membership, and owned child/grandchild cleanup while an unrelated sentinel survives.
- `tests/browser/catalog-media.spec.ts`: the two existing homepage scrolls retry until the correct raw locator is unique and visible. Product, variant, stock, price, media and commerce assertions remain unchanged. No `.first()` workaround, skipped assertion, fixed sleep, or global timeout change was added.
- `package.json` and `pnpm-lock.yaml`: exact `serialize-javascript` 7.1.3 override, within its existing consumer's `^7.0.3` range. No other dependency is upgraded.

Fresh main-agent verification in the isolated Windows checkout:

| Check | Result |
| --- | --- |
| Frozen dependency installation | Passed. |
| Full audit and production audit | Both passed: zero advisories, including low severity. No advisory ignore was introduced. |
| Internal/PWA production build | Passed, exercising the patched build tool. |
| Real production media browser specification | Passed: 1/1 after the committed-test wait correction. This remains separate from the earlier 14/1 run. |
| Native launcher contract suite | Fresh final run passed: 7/7, with no skips. |
| Restricted-token PostgreSQL smoke | Startup, `SELECT 1`, shutdown and return to the calling PowerShell script passed. |
| Checkout HTTP through the exact restricted `node --run` command path | Passed: 1 file / 9 tests against isolated PostgreSQL. |
| Independent dependency/test and native security reviews | No remaining blocking finding. Runtime verification belongs to the main agent. |

Earlier native verification failures are retained: the first compile probe found a C# name collision; the first contract suite passed 1 and failed 4 because PowerShell's JSON array type check rejected valid arrays; the next passed 6 and failed 1 because the fixture compared an 8.3 directory alias with its expanded path. Grok corrected these and the final complete 7-case suite passed. Exit-code 259 and embedded-NUL handling have dedicated coverage. Two overlong implementer investigation runs were stopped without code changes; a later one-line fixture task reached its turn limit after applying the reviewed fix. Implementer status is not used as test evidence.

Follow-up evidence remains under the isolated checkout's `.scratch/security-dependency-20261025/`: `followup-install.log`, `followup-audit-{full,prod}.json`, `followup-internal-build.log`, `followup-production-media.log`, `followup-runner-{first-probe,contract-first,contract-retry,contract-final}.log`, and `followup-restricted-checkout-completion.txt`. Native smoke output was captured in the execution transcript; its success is not inferred from the wrapper's own report. No generated files, logs, screenshots, temporary fixtures/data, or protected reviews are commit candidates.

Fresh hosted Windows CI must still pass at the exact follow-up commit. Local checks do not establish that the elevated hosted environment has passed. No merge, issue closure, deployment, practice-data change, or upgrade of the running practice processes is part of this follow-up.

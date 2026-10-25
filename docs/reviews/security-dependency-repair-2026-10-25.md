# PR #45 security dependency repair — 25 October 2026

This is a bounded dependency repair following the owner's explicit approval. It does not approve merging, deployment, or production launch.

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

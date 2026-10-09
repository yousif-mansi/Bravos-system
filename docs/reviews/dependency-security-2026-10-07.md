# Dependency security patch — 2026-10-07

The fresh October 7 production audit reported 10 advisory entries: one critical, four high and five moderate. A full workspace audit reported 14 entries: one critical, six high, six moderate and one low. These are package/version advisory entries, not evidence that an application endpoint is exploitable. The same advisory can appear against multiple maintained package versions.

## Changes and compatibility

Only dependency manifests and the lockfile changed for this patch. Application source, business rules, database migrations, architecture, authentication configuration and lifecycle hooks are unaffected.

| Package | Previous → patched | Dependency path and official evidence |
| --- | --- | --- |
| Next.js | 16.3.4 → 16.3.6 | Storefront direct dependency; [Node ImageResponse advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j), [16.3.6 release](https://github.com/vercel/next.js/releases/tag/v16.3.6). Matching `@next/env` and platform SWC packages also move to 16.3.6. |
| sharp | 0.35.4 → 0.35.5 | API and catalog direct dependencies, plus Next's compatible optional `^0.35.4` dependency; [librsvg advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w), [0.35.5 release](https://github.com/lovell/sharp/releases/tag/v0.35.5). Platform sharp packages move to 0.35.5 and prebuilt libvips packages to 1.3.4, which supply patched librsvg 2.63.2. |
| Fastify | 5.12.3 → 5.12.5 | API direct dependency; [HTTP/2 trailer advisory](https://github.com/fastify/fastify/security/advisories/GHSA-4mh8-r7rc-xpvc), [5.12.5 release](https://github.com/fastify/fastify/releases/tag/v5.12.5). |
| fast-uri | 3.1.7 → 3.1.8; 4.1.4 → 4.1.5 | AJV `^3.0.1`; Fastify AJV compiler and fast-json-stringify `^4.0.0`. [Host normalization advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj), [mailto advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-jvvf-x445-j334), [3.1.8 release](https://github.com/fastify/fast-uri/releases/tag/v3.1.8), [4.1.5 release](https://github.com/fastify/fast-uri/releases/tag/v4.1.5). |
| brace-expansion | 2.1.4 → 2.1.7; 5.0.9 → 5.0.12 | ExcelJS → archiver → glob → minimatch 5 (`^2.0.1`), minimatch 9 (`^2.0.2`), and development Workbox → glob → minimatch 10 (`^5.0.8`). [CPU stall](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr), [nested groups](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-qhr7-859c-m2p7), [comma recursion](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-6j4f-fj2g-mc7p). Both existing major families receive their own patches. |
| source-map-js | 1.2.1 → 1.2.2 | PostCSS `^1.2.1`, through Next and Vite/Vitest. The production audit includes Better Auth's dependency path to Vitest/Vite; this does not establish a public source-map processing endpoint. [Upstream fix](https://github.com/7rulnik/source-map-js/pull/79), [1.2.2 release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2). |
| serialize-javascript | 7.1.1 → 7.1.2 | Development Workbox → `@rollup/plugin-terser` 1.0.0 (`^7.0.3`). [Function serialization advisory](https://github.com/yahoo/serialize-javascript/security/advisories/GHSA-gfhx-hw2g-v5hg), [7.1.2 release](https://github.com/yahoo/serialize-javascript/releases/tag/v7.1.2). |

Registry manifests were checked against the actual locked parent versions. Fastify 5.12.3 and 5.12.5 declare the same dependency ranges; the existing Pino 9.14.0 satisfies `^9.14.0 || ^10.1.0`. Next retains its PostCSS 8.5.23 pin, React 19 compatibility and optional sharp range. Existing nonsecurity children were retained, including Pino, proxy-addr, browser compatibility data and nanoid. All selected patches support the pinned Node 22.13.1 runtime; pnpm remains 10.34.5.

The first lock-only resolver pass refreshed unrelated children and did not refresh every unchanged parent's vulnerable transitive. That candidate was discarded before installation. The final lockfile preserves the original graph, substitutes only the approved patches and required Next/sharp platform packages, and takes each changed package's SHA-512 integrity from its exact npm registry manifest. This accounts for 44 changed package entries; importer and snapshot references follow those entries. There are no new overrides. The existing ExcelJS UUID override and Linux/Windows build allowlist are preserved.

## Advisory applicability

The critical Next advisory concerns Node.js `next/og` image generation with attacker-controlled SVG content, attributes or styles. A source search found no `next/og` or `ImageResponse` usage in application or package source. It is patched as a vulnerable installed dependency without claiming a demonstrated BRAVOS RCE route.

The sharp advisory concerns upstream SVG decoding and possible RCE under specific glibc Linux runtime conditions. Product uploads validate filename, MIME and JPEG/PNG/WebP byte signatures before calling sharp, and verify the decoded format and dimensions. Raw SVG is outside that accepted path. The illustration utility uses trusted local SVG. These observations limit the demonstrated reachability; they do not replace upgrading the native dependency or verify a future Linux host.

The Fastify issue requires HTTP/2 plus a response trailer. The current API constructs `Fastify({ logger: false })`; application/package source searches found no HTTP/2 enablement or `reply.trailer()` use. fast-uri's host and mailto issues depend on the caller's decisions about untrusted parsed values; no direct application imports were found. Brace expansion issues require untrusted expansion/glob patterns. Source-map denial of service requires processing crafted indexed maps. The serialize-javascript issue affects function serialization into HTML, whereas its observed path is development minification. Package presence alone establishes none of these exploit conditions.

## Verification and handoff

At the dependency freeze, using Node 22.13.1 and pnpm 10.34.5:

- `pnpm install --lockfile-only --frozen-lockfile --ignore-scripts` passed for all 24 workspace projects, without installing application dependencies or running lifecycle scripts.
- `pnpm audit --prod --json` exited 0: all severity counts zero, 458 dependency graph entries.
- `pnpm audit --json` exited 0: all severity counts zero, 776 dependency graph entries.
- `git diff --check` passed for the dependency edits.

Raw audit evidence is retained in the isolated runtime's `.local/review-audit-prod-patched-20261007.json` and `.local/review-audit-full-patched-20261007.json`. These are point-in-time registry results, without ignored or muted advisories.

Frozen SHA-256 identities:

| File | SHA-256 |
| --- | --- |
| `pnpm-lock.yaml` | `9B429B84A5B0B9E8810F90750EDC85D90508C4D0CD46C785D38E00385B558BB4` |
| `apps/api/package.json` | `47408B6EDBD334DCC6E47EAC50EE2E57D1378D995FDF40382041E6A7A6910E43` |
| `apps/storefront/package.json` | `6AE52CDA535ADDBE3D82E083BF6BCDE72C23C62D333D49EC49D2444FC04FA49B` |
| `packages/catalog/package.json` | `2F54E730E0CC7390F9B92F06B107B2F5DDA9715A0DA2BA03EF97AC74306822B0` |
| Root `package.json`, including the coordinator's existing Linux build allowlist | `0CEF5E77549E12EE3548C70DFAEAC3B33600AD36DBC7C9C5E079A00BCB3B29E7` |

The runtime owner subsequently confirmed a real root frozen install passed in 65.1 seconds, and read the installed Node 22.13.1, Fastify 5.12.5, sharp 0.35.5, Next 16.3.6 and librsvg 2.63.2 versions. The existing local PostgreSQL migration/count/balance facts were unchanged. The owner continues the isolated frozen install, media/authentication/storefront regression tests, typecheck, architecture checks and production builds; those remaining gates are pending at this checkpoint and belong to the coordinated readiness run. The earlier browser run used the old dependencies and is not relabelled as patched verification. No services, production deployment, business database, staging, commit or push were changed by the dependency patch author.

## Main-review addendum — 9 October 2026

The current reviewed toolchain uses Node 22.23.3, pnpm 10.34.5 and Next 16.3.8. The current lock SHA-256 is `76AF25D6D72588F1DE04E894CE859FD5C69C0D3349AF46C41B64F42FD9000526`.

The dated October 9 full and production audit snapshots report zero advisories across 776 and 458 dependencies respectively, with empty muted arrays. These supersede the earlier boundary for current candidate identity while retaining its historical results and the October 9 pre-refresh advisory snapshot. They are not a permanent security guarantee or hosted Linux verification.

See the [main review](production-readiness-main-review-2026-10-09.md) for exact audit evidence, installed-version/source provenance, compatibility verification and remaining gates. Hosted CI has not executed; publication and hosted execution still require explicit approval.

# Storefront production lab measurements (SF-11)

`scripts/measure-storefront-performance.mjs` measures an **already-running, permitted, isolated production storefront**. It never builds, starts or seeds a server. A rejected production launch must be resolved separately; this script is not a workaround. The running business preview must remain unchanged. Use only `localhost` or `127.0.0.1` and an isolated database/API/media fixture: ordinary visits and product views increment analytics even without checkout interactions.

## Operator preparation

Use the repository's pinned Node and existing Playwright installation/browser. Prepare the production service through the permitted operator workflow before running this tool. Confirm its build/source label, production serving command and isolated backend. The `--attest-isolated-production` flag records your statement; the browser cannot prove the source commit or server mode. Do not pass a development server and describe its timing as production evidence.

Supply a stocked, public product ID and an existing anonymous Playwright `storageState` JSON file for the exact measurement origin. Export from an isolated guest cart prepared separately by the operator; this tool does not add items. The file must contain `cookies: []`, exactly one `origins` entry, and only `bravos-guest-cart-v1` in that origin's `localStorage`. No other keys, IndexedDB, authentication, customer fields, pending checkout attempts or completed operation IDs are accepted. Cart lines must be valid, orderable and within available stock, including repeated variant quantities. A v1 cart envelope or the baseline's legacy cart array is accepted. The file contents are never copied into the report; only its SHA-256, line count and unit count are recorded. Keep the input file in ignored local storage.

Configure delivery areas beforehand in the isolated fixture. Cart must render its lines and checkout link; checkout must render its item summary, available area choices, and blank fields. The product must show a stocked enabled variant and quantity control. Readiness uses selectors present in both `15fd366` and the current storefront. An incompatible/unready route fails explicitly; the tool does not infer baseline parity or silently accept an empty-cart page. No customer fields are entered, area selected, quote requested, cart changed or order submitted. Automatic visit/product-view analytics are allowed; all other non-GET/HEAD requests are blocked and invalidate a sample.

Require an asset description with approval/source references in `--photo-provenance`, a shared catalog/stock/media fixture identifier in `--fixture-label`, and `--photo-kind representative` or `synthetic`. These are operator statements, not an automated photograph/approval check. Identify the homepage hero assets and their addition/absence in `--hero-note`. No image upload or business data modification is part of measurement.

## Run

Example in PowerShell, after the permitted isolated service is already running:

```powershell
node scripts/measure-storefront-performance.mjs `
  --origin http://127.0.0.1:3005 `
  --product-id EXISTING-PUBLIC-PRODUCT-ID `
  --cart-state .scratch/anonymous-cart.json `
  --build-label 'final SOURCE-COMMIT; operator-attested next start' `
  --photo-kind synthetic `
  --photo-provenance 'Isolated demo illustrations; no approved garment photographs' `
  --fixture-label 'isolated catalog snapshot IDENTIFIER' `
  --hero-note 'Final adds homepage cover; baseline has no photo hero' `
  --attest-isolated-production `
  --output .scratch/storefront-performance-final
```

`--help` loads no browser and writes nothing. The default output is a timestamped direct child of ignored `.scratch`. An explicit output must also be a new direct child; existing directories and redirected `.scratch` paths are rejected. Application paths cannot be output targets. `metrics.json` is saved after each sample; failures exit nonzero and preserve an explicitly incomplete report with the failed route/viewport/run. A successful capture contains exactly 24 samples, with medians for each three-run group; never compare a partial capture as a completed matrix.

## Recorded conditions and metric definitions

Each of home `/`, product `/products/ID`, populated cart `/cart` and initial checkout `/checkout` receives three sequential cold navigations at phone 390×844 and desktop 1440×1000. Every sample uses a fresh Chromium context, disabled browser HTTP cache via CDP and blocked service workers. Only cart/checkout receive the sanitized prepared state. The installed Playwright Chromium version is recorded. Headless Chromium uses the desktop user agent, DPR 1, Arabic locale, Cairo timezone and normal motion; “phone” means viewport emulation, not a physical device.

Both viewports use CDP latency 150ms, download 1.6Mbps, upload 750Kbps and CPU slowdown 4×. CPU slowdown is relative to the operator's machine; retain its hardware/OS and foreground load separately alongside the report for reproducibility. Server/API/image caches are not cleared and can be warm. No competing browser workloads should run. The tool observes the initial viewport until ten seconds after the load event, with fonts/readiness required inside that window. It does not scroll or click. This bounded lab window is not a full page-session metric.

- **LCP:** Last buffered `largest-contentful-paint` entry in the observation window, including time in milliseconds, element tag, size and media URL when available. Missing LCP fails the sample.
- **CLS:** Maximum session-window score, excluding shifts with recent input. A new window begins at a gap of at least 1 second or elapsed window length of at least 5 seconds. Raw shift values/timestamps are retained; this is not a lifetime sum.
- **Image/JS bytes:** CDP `Network.loadingFinished.encodedDataLength` totals grouped by browser resource type/MIME. These are compressed on-wire browser-reported transfer bytes including protocol overhead where Chromium accounts for it. Resource Timing encoded body bytes are included separately when exposed; zero/unavailable cross-origin body sizes must not be interpreted as zero network transfer. CDP totals exclude server-side fetches. CSS background images count through their MIME/type.
- **Requests:** CDP request events include the document, automatic analytics, resources and redirect hops. CDP request rows retain only the final response of a redirect chain; image/JS/all transfer totals omit bytes from earlier redirect hops. Request and redirect counts remain accurate. If `redirects` is nonzero, investigate those hops before treating the byte totals as complete for budget or baseline comparisons. Incomplete requests are counted separately and their eventual bytes are unknown, rather than assumed zero.
- **Media/quality diagnostics:** Visible image loading, horizontal overflow, prioritized image URLs, HTTP/network errors and page errors are retained. Prioritized images are candidates, not a verified hero identity; use the operator's hero note and network URLs to account for hero bytes separately. Runtime/network failures, missing visible images and cached responses invalidate the capture.

The script does not collect request bodies, response bodies, storage contents or customer text. Network URLs still contain fixture product/media identifiers; use isolated public fixture data and do not put credentials or personal information in URLs or provenance text.

Pure verification (no browser, server or output files): `node --check scripts/measure-storefront-performance.mjs`, `node scripts/measure-storefront-performance.mjs --help`, and `node --test tests/scripts/storefront-performance.test.mjs`. The focused tests cover CLS session boundaries, recent-input exclusion, help, missing arguments and remote-origin rejection. Browser route interception adds harness overhead consistently to every sample; compare only runs using this same procedure.

## Comparison and acceptance boundary

Keep [SF-11](../planning/tickets/storefront/SF-11.md) open until its full evidence exists. For a comparison, independently provide permitted, isolated production servers for `15fd366` and the final build; run this same tool/browser against the same approved catalog, stock, cart and photograph fixture under the same machine and throttling conditions. Origin-specific cart exports are necessary if ports differ. Record lockfile/toolchain/source/build provenance separately; the script's label alone is not proof of the served build.

The historical immediate SF-01 diagnostic remains separate: its scratch runner used an incomplete matrix and lifetime CLS summation, so do not relabel it as this matched 24-sample baseline. The old homepage had no photographic hero. Account for the final hero's requests/bytes separately and disclose the unequal homepage workload. A tiny catalog, unrelated photos, placeholders or synthetic illustrations cannot establish representative performance acceptance even if lab targets pass.

Proposed targets remain CLS ≤0.1 and phone median LCP ≤2500ms for each route under the recorded conditions. The report supplies observations and medians, not automatic SF-11 signoff. Investigate unexplained regressions and retain all three samples. Gallery/filter/add/field-entry interaction traces, decorative-motion long-task inspection, image access/revocation guards, representative approved assets, matched old/final evidence and real-device/release checks remain separate work. No field p75, INP, physical-device or complete production-readiness claim follows from this script.

# Sample catalog intake

This tool adds the authorized fictional apparel range to a development workspace through the existing feature HTTP API. It is not a database seed, a reset, or the isolated storefront demo. Run it from the repository root only after the API is already serving the ordinary development database.

The manifest is `assets/sample-catalog/catalog.json`, version `bravos-sample-range-2026-10-13-v1`. It defines 30 products: 8 Pants, 6 Jackets, 8 Shirts, and 8 T-Shirts. Each product has one color and four sizes. Apply receives 5 units of each variant in each of the two configured branches on the fixed receipt date 2026-10-13. The script accepts only that file. Category prices, costs, and sizes must match the authorized table in the manifest; request bodies then use those parsed values. Image-generation notes stay in the manifest and are not sent.

Main owns the manifest and the image files. This tool does not create images, edit the manifest, or start Postgres, the API, or a demo stack.

## Commands

Plan prints product, variant, and per-branch quantity lines. It does not read credentials, sign in, or fail when an image is missing.

```powershell
pnpm exec tsx scripts/sample-catalog.ts plan
```

Apply and verify require reviewed development execution. They refuse every target except API `http://127.0.0.1:3010` and Origin `http://127.0.0.1:5173`.

```powershell
pnpm exec tsx scripts/sample-catalog.ts apply --credentials-file .local/demo-credentials.txt
pnpm exec tsx scripts/sample-catalog.ts verify --credentials-file .local/demo-credentials.txt
```

Owner credentials may instead be supplied together as `BRAVOS_SAMPLE_CATALOG_USERNAME` and `BRAVOS_SAMPLE_CATALOG_PASSWORD`. Do not set those and also pass `--credentials-file`. The credentials file must be an explicit file inside `.local`, in the existing labeled format (`owner login:` and `owner password:`). The cashier lines are ignored. A password value of `unknown` is rejected. The tool does not read `BRAVOS_SETUP_OWNER_PASSWORD`, e2e secrets, or `.local/storefront-demo/`. It never prints the password, the session cookie, or purchase costs.

`--api` and `--origin` exist so the target is visible. Any value other than the two development origins is an error. The command also stops when `NODE_ENV=production`, when `BRAVOS_LOOPBACK_REHEARSAL=true`, or when `BRAVOS_API_ORIGIN` or `BRAVOS_INTERNAL_ORIGIN` points somewhere else. A sign-in cookie with a `__Secure-` or `__Host-` prefix stops the run before catalog writes. The health check must return the Bravos public application identity. Port 3011 and the isolated demo on port 3012 are not accepted.

## Image format

Each manifest image path must be `images/<product code>.png` or `images/<product code>.webp`. The catalog API already accepts both. Apply does not choose the format from the path alone. It reads the file and accepts a PNG signature or a WebP container whose dimensions come from a VP8 keyframe, VP8X canvas, or VP8L header. The file must stay within the existing catalog limits: 5 MiB, 8000 pixels on a side, and 20 million pixels. A path extension that does not match those bytes is rejected. Animated WebP is rejected.

The upload body uses that detected type: `BRV-SAMPLE-001.webp` with `image/webp`, or the PNG pair. A saved upload intent still has `fileName`, `contentType`, `byteLength`, and `sha256`. `contentType` may be `image/png` or `image/webp`, and the file name must end with the matching extension. Receipt and product checkpoints are unchanged. If a saved upload intent was for the other format, apply stops and does not upload a second file.

A saved upload response is reused only when the product still has no image, or its single image ref is that saved ref. Any other image already on the product stops apply. The same check runs again on the product read immediately before the first publish payload is built, and before any PATCH. A manager-chosen image is not replaced. An empty image list on the still-hidden product may receive the checkpointed upload.

Server-side Sharp still decodes the uploaded bytes. This preflight only reads the container header. Verify reads the public media response and checks that its content type, signature, and pixel dimensions match the manifest file. It does not compare every byte.

## What apply writes

Apply uses manager feature routes only. It does not open a database connection, bootstrap an account, reset stock, or call checkout, orders, contacts, delivery, staff, backup, or restore routes.

Before any mutation it stores a one-time snapshot of workspace branches, categories, sizes, colors, normalized manager products, and receipt facts at `.local/sample-catalog/bravos-sample-range-2026-10-13-v1/baseline-snapshot.json`. That directory is gitignored. Later runs keep the first snapshot. An unreadable snapshot stops the run and is not replaced.

For each sample code it then:

1. Reuses one root category, size, or color with the exact English `nameAr`, or creates the missing name. More than one record with that name, or a category that exists only as a child, stops the run.
2. Creates the product hidden, with `onlineVisible: false` on the four explicit pairs and no image. English copy is stored in the existing `nameAr` and `descriptionAr` fields. Image-generation provenance is not sent.
3. If that SKU already exists, adopts it only when the code, name, description, category, price, size guide, overrides, and four pairs match. Any other collision stops the run. Lookup is by that fixed SKU, not by a similar name.
4. Posts one receipt per branch with an explicit `branchId`. The operation id, date, branch, variant ids, quantity, and cost are written to disk before the request. A rerun sends that same payload or, when the response checkpoint already exists, only rereads it. The receiving operation replays instead of adding stock. Consumed units are not refilled. The active branch is not switched. If this process finds that a previously selected active branch changed, it posts that original branch and stops. If the active branch was unset and later becomes set, the tool stops without clearing it.
5. Uploads `fileName`, `contentType`, and base64 only when no upload checkpoint exists. The name and content type are the detected PNG or WebP. The image must already fit the catalog media limits: 5 MiB, 8000 pixels on a side, and 20 million pixels. The server still performs its own decode. A saved upload without a media ref does not upload a second file.
6. Publishes with a full product PATCH: current `expectedRevision`, current `expectedVariantIds`, the same pairs, one image ref, and `onlineVisible: true`. A revision conflict causes one fresh read. The save is kept only when that read is already the sample. Otherwise the run stops and does not write a newer revision over the conflict.

Apply prints progress by sample code. It does not print a verification pass. Run verify separately.

## Verify

Verify signs in and only reads. It checks that all 30 sample products are public and in stock, each detail has the four size/color pairs at the manifest selling price, public quantity is 5, and each public media response has the same PNG or WebP type, signature, and dimensions as the manifest file. Public JSON is scanned for cost and profit fields. Manager receipt reads must still show the original quantity, cost, date, branch, and variant ids, with no correction, and current remaining quantity must still be 5 on each sample receipt. A lower remaining quantity fails verify and is not repaired by apply.

Products, taxonomy, branches, and receipts present in the baseline must remain. Sample products that were already in that baseline may only move from hidden to the published sample state. Verify does not create an order, a sale, or a quote.

Verify belongs immediately after intake, while each sample receipt still has remaining quantity 5. Later legitimate stock movements can change that quantity; sellable returns restore their original cost batches. Apply does not refill it. Do not use verify as the client-readiness gate after those movements. `pnpm setup:local` is a different command: it labels a development database and accounts, and it does not load this catalog or its images.

There is no pass output unless those reads match. A missing baseline stops verify without writing one.

## Failures

| Situation | Result |
| --- | --- |
| API is not `http://127.0.0.1:3010`, or Origin is not `http://127.0.0.1:5173` | Stop before sign-in |
| `NODE_ENV=production`, loopback rehearsal, or a non-development configured origin | Stop before sign-in |
| Health response is not the Bravos public API | `The target did not identify itself as the Bravos development API.` |
| API is down | `The development API is not reachable at http://127.0.0.1:3010.` |
| Sign-in is rejected | `Sign-in was rejected (<status>).` No response body is printed |
| Secure production cookie | Stop before catalog writes |
| Workspace does not have exactly Abshway and Fayoum | Stop before writes |
| Signed-in account cannot manage catalog and inventory | Stop before writes |
| Image missing, over the media limit, or not the PNG/WebP named by its path | Apply lists the codes and stops before credentials are required |
| Existing SKU facts differ | `Product <code> collides with an existing SKU whose facts differ` |
| Saved receipt payload differs | Stop before a new receipt is posted |
| Upload checkpoint has no media ref | Stop without uploading again |
| Product already has an image ref other than the saved upload | Stop before publish and do not replace that image |
| PATCH revision conflict and the fresh product is not the sample | Stop without a second save |
| Checkpoint JSON is unreadable | Stop without deleting it |
| Verify has no baseline | Stop without creating business data |

Do not delete `.local/sample-catalog/` to force a refill. Deleting a receipt intent does not make consumed stock safe to receive again, because the server operation id is derived from the sample version, product code, and branch id.

## Checks that this file does not run

The pure manifest and payload checks live in `tests/scripts/sample-catalog.test.mjs`. They do not sign in or open a port. Run them only after the source lanes have stopped editing:

```powershell
node --import tsx --test tests/scripts/sample-catalog.test.mjs
```

Main subsequently ran the pure checks, apply, and read-only verify on 13 October 2026. Verification checked all 30 public products, explicit pairs, media, receipts, and preservation of prior manager data. The ignored logs are under `.scratch/english-fashion-20261013/`; these local results are not hosted CI or production approval. Do not run `scripts/storefront-demo.ts` for ordinary intake; that seed mutates isolated demo configuration and creates an order.

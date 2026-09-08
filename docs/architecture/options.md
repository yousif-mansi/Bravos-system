# BRAVOS architecture research draft

Checked: 2026-09-08. Q62-Q63 are answered. The [implementation blueprint](../planning/implementation-blueprint.md) proposes a concrete TypeScript/PostgreSQL stack using this research and the checks below. The stack awaits final review; no hosting provider, domain, or paid service has been selected, and no application has been implemented.

## Common application boundaries

One public storefront and one separately built authenticated internal application share a business backend and central inventory. A candidate frontend arrangement is a rendered React/TypeScript storefront plus a React/TypeScript internal PWA; [Next.js supports rendered product pages/metadata](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) and [Node/Docker self-hosting](https://nextjs.org/docs/app/guides/self-hosting), so using it would not itself choose a host. These are candidates, not accepted framework choices.

Keep domain/use-case code behind feature public interfaces and persistence/auth adapters. Offline completed sales require atomic local sale/outbox persistence, stable operation identifiers, duplicate-safe server handling, and explicit batch/stock discrepancy resolution. Neither candidate backend supplies the accepted BRAVOS offline workflow automatically. Module Federation remains deferred.

## Backend candidates

| Concern | Managed PostgreSQL with a TypeScript business backend | Appwrite TablesDB/Auth with a TypeScript business backend |
| --- | --- | --- |
| Cost batches, stock, linked returns/corrections | SQL transactions, constraints and deliberate concurrency control can coordinate sale/order, variant/batch allocations, movements and operation IDs | Current TablesDB documentation supports staged multi-table transactions and atomic commit, with conflict retries and plan limits to check |
| Private purchase costs | Use restricted cost tables and role-specific responses; row security alone is not column filtering | Permissions are table/row based; do not put private costs in employee-readable rows or grant broad table reads |
| Staff login names | Native Supabase password login uses email/phone; username-facing accounts need an identity adapter or another suitable auth implementation | Standard password login uses email; manager-provisioned username-facing login needs private identifier resolution or custom auth |
| Local development without booked hosting | Ordinary local PostgreSQL, or Supabase's Docker-based local stack | Self-hosted Docker setup, with server/SDK transaction compatibility checked |
| Portability and data-only backup | Standard drivers/migrations and logical exports support provider portability; protected download and safe restore remain application work | Self-hosting retains an Appwrite path; leaving Appwrite requires adapting its APIs, IDs and permissions; coherent business-data export/restore remains application work |

Primary references: [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html), [Supabase database functions](https://supabase.com/docs/guides/database/functions), [Supabase column security](https://supabase.com/docs/guides/database/postgres/column-level-security), [Appwrite transactions](https://appwrite.io/docs/products/databases/tablesdb/transactions), [Appwrite permissions](https://appwrite.io/docs/products/databases/tablesdb/permissions), [Supabase password identifiers](https://supabase.com/docs/guides/auth/passwords), [Appwrite password login](https://appwrite.io/docs/products/auth/email-password), [Supabase local development](https://supabase.com/docs/guides/local-development), [Appwrite self-hosting](https://appwrite.io/docs/advanced/self-hosting/installation), [PostgreSQL logical export](https://www.postgresql.org/docs/current/app-pgdump.html).

Appwrite also documents a distinct [native PostgreSQL offering](https://appwrite.io/docs/products/databases/postgresql), using standard SQL drivers rather than the TablesDB SDK/permissions layer. Evaluate it as a PostgreSQL hosting option later, not as evidence that TablesDB behaves like SQL. No hosting reservation is needed for local design/development.

## Provisional assessment and checks

Architectural inference: relational PostgreSQL is the stronger starting candidate for retained purchase-cost batches, linked corrections, returns, and reporting, because those operations naturally need constraints and transactions across related records. Appwrite remains viable and must not be dismissed as lacking transactions. The blueprint supplies the concrete adapter/auth proposal and local runtime findings. Final review and a live pinned-version provisioning/database proof remain before accepting the foundation.

Before accepting a stack, verify competing stock/batch allocations, duplicate/lost-response retries, late offline sales, role-filtered responses/caches, username provisioning/reset, restart/update preservation of unsynchronized records, and encrypted coherent data-only restore. Confirm transaction limits against realistic baskets and corrections. These are preparation/acceptance checks, not claims that an app or tests already exist.

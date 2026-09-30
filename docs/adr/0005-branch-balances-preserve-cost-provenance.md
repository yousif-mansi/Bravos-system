# Separate branch balances while preserving original cost batches

On 2026-09-29 the user replaced shared central quantities with independent branch stock and required one branch to fulfill each online order. Keep the original purchase-cost batch as the provenance identity, with a balance per batch and branch; a sellable return credits the receiving branch without copying the batch or averaging its cost. This preserves historical FIFO allocations and sale attribution while allowing a return at a different branch, superseding only the central-quantity portion of ADR 0003.

The user declared existing data disposable and chose a fresh start, so the migration refuses to guess locations for existing central stock. Verification uses isolated fresh databases; the existing local database is not silently reset or allocated.

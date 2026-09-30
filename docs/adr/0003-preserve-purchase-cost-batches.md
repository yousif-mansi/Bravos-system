# Preserve purchase-cost batches

The 2026-09-29 decision in [ADR 0005](0005-branch-balances-preserve-cost-provenance.md) supersedes the central-quantity wording below, while preserving separate costs and original-batch provenance.

The user requires new-cost units to remain separate from old-cost units, so a variant retains distinct stock batches and their purchase costs instead of averaging or overwriting them. Available quantities still sum into the same central inventory; cost assignments must remain traceable to the contributing batches. Q63 accepts allocation from the oldest available batch first (FIFO) and restoration of sellable returns to their original allocated batches, preserving costs through sales and returns.

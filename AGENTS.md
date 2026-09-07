# BRAVOS agent instructions

Read `bravos.md` before architecture, technology selection, database design, or implementation. It is the business-requirements baseline; follow later explicit user corrections when they change it.

## Business rules

- Both physical branches and the online store consume one shared central inventory. Keep branch sales, employees, expenses, and reporting distinct.
- Every physical sale records its branch and employee. Physical sales are cash only; online orders are cash on delivery with guest checkout.
- Cost prices and internal business data must never be exposed through public pages or public APIs.
- Enforce role permissions for sensitive actions and attribute important operations to the responsible user.
- Arabic is the primary interface language. Keep employee workflows simple.
- Do not invent unresolved business policies. Consult section 31 of `bravos.md` and `docs/planning/kickoff.md` before finalizing affected features.
- Keep configurable business data, including prices, delivery fees, categories, promotion rules, and low-stock thresholds, out of hard-coded application logic.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `yousif-mansi/Bravos-system`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout: root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

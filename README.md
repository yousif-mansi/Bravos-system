# BRAVOS System

Arabic retail management and online ordering for BRAVOS, a men's clothing business with branches in Abshway and Fayoum, Egypt.

## Project baseline

[bravos.md](bravos.md) is the authoritative business-requirements brief. Read it before choosing architecture, technologies, database structure, or implementation details.

The project is at requirements and repository setup. A runnable application has not been implemented yet.

## Core scope

- One central inventory shared by both physical branches and the online store.
- Product and size/color variant management, stock receiving, and low-stock visibility.
- Cash POS with each physical sale attributed to a branch and employee.
- Employee accounts, role permissions, and attribution for important actions.
- Branch expenses, owner dashboards, profit visibility, and PDF/Excel reports.
- Branded Arabic online store with product search, cart, guest checkout, and cash on delivery.
- Staff-managed online orders, configurable Fayoum delivery areas and fees, controlled promotions, and website analytics.

Internal cost prices must remain private. Branch sales and expenses stay distinguishable even though inventory is shared.

## Getting started

1. Read [the business brief](bravos.md).
2. Review [the kickoff plan and open decisions](docs/planning/kickoff.md).
3. Use [GitHub Issues](https://github.com/yousif-mansi/Bravos-system/issues) for specifications and implementation tickets.
4. Follow [AGENTS.md](AGENTS.md) and the [engineering-skills configuration](docs/agents/issue-tracker.md).

Engineering skills live in `.agents/skills/`; their sources are recorded in [skills-lock.json](skills-lock.json). The installed set includes triage, specification writing, ticket breakdown, domain modeling, implementation, testing, and code review.

## Implementation boundaries

Online order statuses and stock timing, returns/exchanges, low-stock thresholds, and promotion rules require decisions before the affected features are finalized. See section 31 of the brief for all open requirements.

The current brief excludes separate branch stock, stock transfers, customer accounts, online payment gateways, receipt printing, and a native mobile app.

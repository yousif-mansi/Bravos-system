## Parent

Specification: https://github.com/yousif-mansi/Bravos-system/issues/1. This implementation ticket: https://github.com/yousif-mansi/Bravos-system/issues/2.

## What to build

The manager signs into a local Arabic staff application, creates personal staff accounts with login names and passwords, assigns branch access, resets/disables staff accounts and uses a separate owner-recovery route. An employee signs in and selects an authorized active branch, shown clearly throughout the staff interface. A separate public application entry/build contains no staff screens. This is the first verifiable workflow in the approved architecture; it establishes the real authentication and database test boundary used by later slices.

## Acceptance criteria

- [ ] A documented local setup starts the staff app, separately built public entry and shared API using the approved TypeScript/pnpm, React/Vite, Next.js, Fastify and PostgreSQL architecture. Dependency versions are pinned and actually installed/verified; configuration has safe examples without real secrets or production data.
- [ ] Manager-created personal username/password accounts need no staff email. Prove the Better Auth PostgreSQL identity adapter, username normalization/uniqueness, Arabic display names, manager password reset, separate owner recovery and revocation. Do not introduce custom password/session cryptography or public staff signup.
- [ ] Manager provisioning assigns one or both configured branches and explicit cashier/order-representative access. Employees cannot provision accounts, grant themselves privileges, list private staff data or select an unassigned branch through a forged HTTP request.
- [ ] The employee sees and can switch only among assigned branches. Server reads and writes validate the authenticated identity and current grants; browser-supplied identity/role/branch fields are not proof of access.
- [ ] Disabled accounts and revoked sessions cannot start new connected work. Login/logout do not introduce destructive browser-storage clearing; the later offline queue must be able to survive these operations.
- [ ] Same-origin frontend gateways, cookie behavior, trusted origins and CSRF protection are verified. Public entry URLs/builds do not contain internal pages or privileged modules. Recovery/reset endpoints do not expose secrets or allow account takeover.
- [ ] A simple Arabic RTL staff UI works at desktop/tablet and phone widths with accessible labeled forms, useful errors and empty states. No fake sales, balances, or unimplemented business controls are represented as working functionality.
- [ ] Feature public interfaces, inward layer imports and cycle boundaries are enforced by an automated check; real route splitting is verified. Avoid empty speculative modules for all future features.
- [ ] Tests run through authenticated public HTTP operations against real isolated PostgreSQL and production adapters. A focused real-browser sign-in/branch/public-separation flow proves gateway/session behavior. Record red-before-green evidence, then passing typecheck, architecture, test and build gates. Round-trip migrations on a scratch database.
- [ ] Document commands, environment requirements, actual verified versions, owner bootstrap/recovery procedure and remaining limits. No domain, hosting or production deployment is required.

## Blocked by

None (can start immediately).

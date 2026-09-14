/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Keep the module graph free of cycles.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "identity-domain-inward-only",
      comment: "Identity domain must not import application, adapters, UI or infrastructure.",
      severity: "error",
      from: { path: "^packages/identity/src/domain" },
      to: {
        path: "(packages/identity/src/(application|adapters)|packages/catalog|apps/|better-auth|fastify|react|next|vite|pg)",
      },
    },
    {
      name: "catalog-domain-inward-only",
      comment: "Catalog domain must not import application, adapters, identity, UI or infrastructure.",
      severity: "error",
      from: { path: "^packages/catalog/src/domain" },
      to: {
        path: "(packages/catalog/src/(application|adapters)|packages/identity|packages/inventory|packages/receiving|packages/sales|apps/|better-auth|fastify|react|next|vite|pg)",
      },
    },
    {
      name: "inventory-domain-inward-only",
      comment: "Inventory domain must not import application, adapters, UI or infrastructure.",
      severity: "error",
      from: { path: "^packages/inventory/src/domain" },
      to: {
        path: "(packages/inventory/src/(application|adapters)|packages/identity|packages/catalog|packages/receiving|packages/sales|apps/|better-auth|fastify|react|next|vite|pg)",
      },
    },
    {
      name: "receiving-domain-inward-only",
      comment: "Receiving domain must not import application, adapters, UI or infrastructure.",
      severity: "error",
      from: { path: "^packages/receiving/src/domain" },
      to: {
        path: "(packages/receiving/src/(application|adapters)|packages/identity|packages/catalog|packages/inventory|packages/sales|apps/|better-auth|fastify|react|next|vite|pg)",
      },
    },
    {
      name: "sales-domain-inward-only",
      comment: "Sales domain must not import application, adapters, UI or infrastructure.",
      severity: "error",
      from: { path: "^packages/sales/src/domain" },
      to: {
        path: "(packages/sales/src/(application|adapters)|packages/identity|packages/catalog|packages/inventory|packages/receiving|apps/|better-auth|fastify|react|next|vite|pg|dexie)",
      },
    },
    {
      name: "application-inward-only",
      comment: "Application use cases depend inward, not on Fastify, pg, React or Better Auth.",
      severity: "error",
      from: { path: "^packages/(identity|catalog|inventory|receiving|sales)/src/application" },
      to: {
        path: "(packages/(identity|catalog|inventory|receiving|sales)/src/adapters|apps/|better-auth|fastify|react|next|vite|\\bpg\\b|dexie)",
      },
    },
    {
      name: "contracts-are-safe",
      comment: "Shared contracts must not pull restricted feature packages or UI kits.",
      severity: "error",
      from: { path: "^packages/contracts" },
      to: {
        path: "(packages/identity|packages/catalog|packages/inventory|packages/receiving|packages/sales|apps/|better-auth|fastify|pg|react|next)",
      },
    },
    {
      name: "internal-app-no-server-identity",
      comment: "The staff UI talks HTTP and may use safe contracts plus the sales browser entry.",
      severity: "error",
      from: { path: "^apps/internal" },
      to: {
        path: "(packages/identity|packages/catalog|packages/inventory|packages/receiving|packages/sales/src/(index|node)\\.ts|packages/sales/src/application/sales\\.ts|packages/sales/src/adapters/postgres-sales\\.ts|packages/sales/src/domain/fingerprint\\.ts|packages/persistence|apps/api|better-auth|fastify|\\bpg\\b)",
      },
    },
    {
      name: "storefront-no-internal",
      comment: "The public entry cannot import staff screens, identity, catalog or API internals.",
      severity: "error",
      from: { path: "^apps/storefront" },
      to: {
        path: "(apps/internal|packages/identity|packages/catalog|packages/inventory|packages/receiving|packages/sales|packages/persistence|apps/api|better-auth)",
      },
    },
    {
      name: "no-private-package-imports",
      comment: "Cross-package imports must use public package entry points.",
      severity: "error",
      from: { pathNot: "^packages/identity/src" },
      to: { path: "^packages/identity/src/(domain|application|adapters)/" },
    },
    {
      name: "no-private-catalog-imports",
      comment: "Cross-package imports must use the catalog public interface.",
      severity: "error",
      from: { pathNot: "^packages/catalog/src" },
      to: { path: "^packages/catalog/src/(domain|application|adapters)/" },
    },
    {
      name: "no-private-inventory-imports",
      comment: "Cross-package imports must use the inventory public interface.",
      severity: "error",
      from: { pathNot: "^packages/inventory/src" },
      to: { path: "^packages/inventory/src/(domain|application|adapters)/" },
    },
    {
      name: "no-private-receiving-imports",
      comment: "Cross-package imports must use the receiving public interface.",
      severity: "error",
      from: { pathNot: "^packages/receiving/src" },
      to: { path: "^packages/receiving/src/(domain|application|adapters)/" },
    },
    {
      name: "no-private-sales-imports",
      comment: "Cross-package imports must use the sales public interface.",
      severity: "error",
      from: { pathNot: "^packages/sales/src" },
      to: { path: "^packages/sales/src/(domain|application|adapters)/" },
    },
    {
      name: "identity-does-not-import-catalog",
      comment: "Identity must not depend on catalog.",
      severity: "error",
      from: { path: "^packages/identity" },
      to: { path: "^packages/catalog" },
    },
    {
      name: "identity-does-not-import-inventory-or-receiving",
      comment: "Identity must not depend on inventory, receiving or sales.",
      severity: "error",
      from: { path: "^packages/identity" },
      to: { path: "^packages/(inventory|receiving|sales)" },
    },
    {
      name: "catalog-does-not-import-inventory-or-receiving",
      comment: "Catalog depends on availability/reference ports, not inventory or receiving packages.",
      severity: "error",
      from: { path: "^packages/catalog" },
      to: { path: "^packages/(inventory|receiving|sales)" },
    },
    {
      name: "inventory-does-not-import-receiving-or-catalog",
      comment: "Inventory must not depend on receiving or catalog packages.",
      severity: "error",
      from: { path: "^packages/inventory" },
      to: { path: "^packages/(receiving|catalog|sales)" },
    },
    {
      name: "receiving-does-not-import-catalog",
      comment: "Receiving uses a catalog identity port at composition, not the catalog package.",
      severity: "error",
      from: { path: "^packages/receiving" },
      to: { path: "^packages/(catalog|sales)" },
    },
    {
      name: "sales-does-not-import-catalog",
      comment: "Sales uses a listed-price port at composition, not the catalog package.",
      severity: "error",
      from: { path: "^packages/sales" },
      to: { path: "^packages/(catalog|receiving)" },
    },
  ],
  options: {
    exclude: {
      path: "^(apps|packages)/[^/]+/(dist|\\.next|coverage|test-results|playwright-report)(/|$)",
    },
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};

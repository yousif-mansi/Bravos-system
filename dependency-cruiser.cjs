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
      name: "domain-inward-only",
      comment: "Identity domain must not import application, adapters, UI or infrastructure.",
      severity: "error",
      from: { path: "^packages/identity/src/domain" },
      to: {
        path: "(packages/identity/src/(application|adapters)|apps/|better-auth|fastify|react|next|vite|pg)",
      },
    },
    {
      name: "application-inward-only",
      comment: "Application use cases depend inward, not on Fastify, pg, React or Better Auth.",
      severity: "error",
      from: { path: "^packages/identity/src/application" },
      to: {
        path: "(packages/identity/src/adapters|apps/|better-auth|fastify|react|next|vite|\\bpg\\b)",
      },
    },
    {
      name: "contracts-are-safe",
      comment: "Shared contracts must not pull restricted identity adapters or UI kits.",
      severity: "error",
      from: { path: "^packages/contracts" },
      to: {
        path: "(packages/identity|apps/|better-auth|fastify|pg|react|next)",
      },
    },
    {
      name: "internal-app-no-server-identity",
      comment: "The staff UI talks HTTP and may use safe contracts only.",
      severity: "error",
      from: { path: "^apps/internal" },
      to: {
        path: "(packages/identity|packages/persistence|apps/api|better-auth|fastify|\\bpg\\b)",
      },
    },
    {
      name: "storefront-no-internal",
      comment: "The public entry cannot import staff screens, identity or API internals.",
      severity: "error",
      from: { path: "^apps/storefront" },
      to: {
        path: "(apps/internal|packages/identity|packages/persistence|apps/api|better-auth)",
      },
    },
    {
      name: "no-private-package-imports",
      comment: "Cross-package imports must use public package entry points.",
      severity: "error",
      from: { pathNot: "^packages/identity/src" },
      to: { path: "^packages/identity/src/(domain|application|adapters)/" },
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

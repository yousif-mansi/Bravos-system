import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { Pool } from "pg";
import {
  CatalogValidationError,
  DuplicateProductCodeError,
  createCatalogServices,
  unstockedAvailability,
  type CatalogServices,
} from "@bravos/catalog";
import { createPostgresCatalogStore } from "@bravos/catalog/node";
import {
  BranchNotAuthorizedError,
  DuplicateLoginNameError,
  ForbiddenError,
  IdentityValidationError,
  InvalidRecoveryError,
  NotFoundError,
  UnauthenticatedError,
  createIdentityServices,
} from "@bravos/identity";
import {
  awaitAuthReady,
  createBetterAuth,
  createBetterAuthIdentityProvider,
  createOwnerRecoveryOutbox,
  createPostgresStaffDirectory,
  type IdentityGateway,
} from "@bravos/identity/node";
import type { VerifiedAuth } from "@bravos/identity";
import { applyMigrations } from "@bravos/persistence";
import type { AppConfig } from "./config.ts";

const ALLOWED_AUTH_ROUTES = new Set([
  "GET /api/auth/ok",
  "GET /api/auth/get-session",
  "POST /api/auth/sign-in/username",
  "POST /api/auth/sign-out",
]);

export type BuiltApp = {
  app: FastifyInstance;
  pool: Pool;
  services: ReturnType<typeof createIdentityServices>;
  catalog: CatalogServices;
  auth: ReturnType<typeof createBetterAuth>;
  identity: IdentityGateway;
  close: () => Promise<void>;
};

export async function buildApp(config: AppConfig): Promise<BuiltApp> {
  const recoveryOutbox = createOwnerRecoveryOutbox({
    nodeEnv: config.nodeEnv,
    adapter: config.ownerRecoveryAdapter,
    directory: config.ownerRecoveryOutboxDir,
  });

  const pool = new Pool({
    connectionString: config.databaseUrl,
    options: "-c client_encoding=UTF8",
    ...(config.databasePoolMax ? { max: config.databasePoolMax } : {}),
  });
  pool.on("error", (error) => {
    console.error(sanitizePoolError(error));
  });

  let app: FastifyInstance | undefined;
  try {
    await applyMigrations(pool);
    const auth = createBetterAuth(pool, {
      baseURL: config.authBaseUrl,
      secret: config.authSecret,
      trustedOrigins: config.trustedOrigins,
      secureCookies: config.secureCookies,
    });
    await awaitAuthReady(auth);
    const identity = createBetterAuthIdentityProvider(auth, pool);
    const directory = createPostgresStaffDirectory(pool);
    const services = createIdentityServices({
      identity,
      directory,
      recoveryOutbox,
    });
    const catalog = createCatalogServices({
      store: createPostgresCatalogStore(pool),
      actors: {
        getStaff: (staffId) => directory.getStaff(staffId),
        getSessionBranch: (sessionId) => directory.getSessionBranch(sessionId),
      },
      availability: unstockedAvailability(),
    });

    const instance = Fastify({ logger: false });
    app = instance;
    await registerRoutes(instance, config, auth, identity, services, catalog);

    return {
      app: instance,
      pool,
      services,
      catalog,
      auth,
      identity,
      async close() {
        try {
          await instance.close();
        } finally {
          await pool.end();
        }
      },
    };
  } catch (error) {
    if (app) {
      await app.close().catch((closeError) => {
        console.error(sanitizePoolError(closeError));
      });
    }
    await pool.end().catch((closeError) => {
      console.error(sanitizePoolError(closeError));
    });
    throw error;
  }
}

async function registerRoutes(
  app: FastifyInstance,
  config: AppConfig,
  auth: ReturnType<typeof createBetterAuth>,
  identity: IdentityGateway,
  services: ReturnType<typeof createIdentityServices>,
  catalog: CatalogServices,
) {
  app.addHook("onRequest", async (request, reply) => {
    if (isPrivilegedPath(request.url) && !isTrustedInternalOrigin(request, config)) {
      return reply.status(403).send(errorBody("ORIGIN_DENIED", "مصدر الطلب غير موثوق."));
    }
  });

  await app.register(
    async (instance) => {
      instance.route({
        method: ["GET", "POST"],
        url: "/*",
        async handler(request, reply) {
          const pathname = request.url.split("?")[0] ?? request.url;
          const key = `${request.method} ${pathname.startsWith("/api/auth") ? pathname : `/api/auth${pathname}`}`;
          if (!ALLOWED_AUTH_ROUTES.has(key)) {
            return reply.status(404).send(errorBody("NOT_FOUND", "المسار غير متاح."));
          }
          return forwardAuth(auth, request, reply);
        },
      });
    },
    { prefix: "/api/auth" },
  );

  app.get("/api/public/health", async () => ({
    ok: true,
    application: "bravos-public",
  }));

  app.get("/api/internal/workspace", async (request, reply) => {
    return handle(reply, async () => services.workspace(await verifiedAuth(identity, request)));
  });

  app.get("/api/internal/branches", async (request, reply) => {
    return handle(reply, async () => {
      const workspace = await services.workspace(await verifiedAuth(identity, request));
      return workspace.authorizedBranches;
    });
  });

  app.post("/api/internal/active-branch", async (request, reply) => {
    const body = asObject(request.body);
    return handle(reply, async () =>
      services.selectActiveBranch(await verifiedAuth(identity, request), String(body.branchId ?? "")),
    );
  });

  app.get("/api/internal/staff", async (request, reply) => {
    return handle(reply, async () => services.listStaff(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/staff", async (request, reply) => {
    const body = asObject(request.body);
    return handle(reply, async () => {
      const created = await services.provisionStaff(await verifiedAuth(identity, request), {
        loginName: String(body.loginName ?? ""),
        displayName: String(body.displayName ?? ""),
        password: String(body.password ?? ""),
        role: "employee",
        grants: body.grants,
      });
      reply.status(201);
      return created;
    });
  });

  app.post("/api/internal/staff/:staffId/reset-password", async (request, reply) => {
    const body = asObject(request.body);
    const params = request.params as { staffId: string };
    return handle(reply, async () =>
      services.resetPassword(
        await verifiedAuth(identity, request),
        params.staffId,
        String(body.password ?? ""),
      ),
    );
  });

  app.post("/api/internal/staff/:staffId/disable", async (request, reply) => {
    const params = request.params as { staffId: string };
    return handle(reply, async () =>
      services.disableStaff(await verifiedAuth(identity, request), params.staffId),
    );
  });

  app.post("/api/internal/staff/:staffId/grants", async (request, reply) => {
    const body = asObject(request.body);
    const params = request.params as { staffId: string };
    return handle(reply, async () =>
      services.setGrants(await verifiedAuth(identity, request), params.staffId, body.grants),
    );
  });

  app.post("/api/internal/owner-recovery/request", async (request, reply) => {
    const body = asObject(request.body);
    return handle(reply, async () => {
      try {
        await services.requestOwnerRecovery(String(body.loginName ?? ""));
      } catch (error) {
        if (!(error instanceof IdentityValidationError)) {
          throw error;
        }
      }
      return { accepted: true };
    });
  });

  app.post("/api/internal/owner-recovery/complete", async (request, reply) => {
    const body = asObject(request.body);
    return handle(reply, async () => {
      await services.completeOwnerRecovery(String(body.token ?? ""), String(body.password ?? ""));
      return { recovered: true };
    });
  });

  app.get("/api/internal/catalog/categories", async (request, reply) => {
    return handle(reply, async () => catalog.listCategories(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/catalog/categories", async (request, reply) => {
    return handle(reply, async () => {
      const created = await catalog.createCategory(await verifiedAuth(identity, request), request.body);
      reply.status(201);
      return created;
    });
  });

  app.patch("/api/internal/catalog/categories/:categoryId", async (request, reply) => {
    const params = request.params as { categoryId: string };
    return handle(reply, async () =>
      catalog.updateCategory(await verifiedAuth(identity, request), params.categoryId, request.body),
    );
  });

  app.get("/api/internal/catalog/sizes", async (request, reply) => {
    return handle(reply, async () => catalog.listSizes(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/catalog/sizes", async (request, reply) => {
    return handle(reply, async () => {
      const created = await catalog.createSize(await verifiedAuth(identity, request), request.body);
      reply.status(201);
      return created;
    });
  });

  app.patch("/api/internal/catalog/sizes/:sizeId", async (request, reply) => {
    const params = request.params as { sizeId: string };
    return handle(reply, async () =>
      catalog.updateSize(await verifiedAuth(identity, request), params.sizeId, request.body),
    );
  });

  app.get("/api/internal/catalog/colors", async (request, reply) => {
    return handle(reply, async () => catalog.listColors(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/catalog/colors", async (request, reply) => {
    return handle(reply, async () => {
      const created = await catalog.createColor(await verifiedAuth(identity, request), request.body);
      reply.status(201);
      return created;
    });
  });

  app.patch("/api/internal/catalog/colors/:colorId", async (request, reply) => {
    const params = request.params as { colorId: string };
    return handle(reply, async () =>
      catalog.updateColor(await verifiedAuth(identity, request), params.colorId, request.body),
    );
  });

  app.get("/api/internal/catalog/products", async (request, reply) => {
    return handle(reply, async () => catalog.listProducts(await verifiedAuth(identity, request)));
  });

  app.post("/api/internal/catalog/products", async (request, reply) => {
    return handle(reply, async () => {
      const created = await catalog.createProduct(await verifiedAuth(identity, request), request.body);
      reply.status(201);
      return created;
    });
  });

  app.get("/api/internal/catalog/products/:productId", async (request, reply) => {
    const params = request.params as { productId: string };
    return handle(reply, async () =>
      catalog.getProduct(await verifiedAuth(identity, request), params.productId),
    );
  });

  app.patch("/api/internal/catalog/products/:productId", async (request, reply) => {
    const params = request.params as { productId: string };
    return handle(reply, async () =>
      catalog.updateProduct(await verifiedAuth(identity, request), params.productId, request.body),
    );
  });

  app.get("/api/internal/catalog/lookup", async (request, reply) => {
    const query = request.query as { code?: string | string[] };
    const code = Array.isArray(query.code) ? query.code[0] : query.code;
    return handle(reply, async () => catalog.lookupByCode(await verifiedAuth(identity, request), code));
  });
}

function isPrivilegedPath(url: string): boolean {
  return url.startsWith("/api/auth") || url.startsWith("/api/internal");
}

function isTrustedInternalOrigin(request: FastifyRequest, config: AppConfig): boolean {
  const origin = request.headers.origin;
  if (!origin) {
    return request.method === "GET" || request.method === "HEAD";
  }
  return config.trustedOrigins.includes(origin);
}

async function verifiedAuth(
  identity: IdentityGateway,
  request: FastifyRequest,
): Promise<VerifiedAuth | null> {
  const cookie = request.headers.cookie;
  return identity.getVerifiedAuth(typeof cookie === "string" ? cookie : "");
}

async function forwardAuth(
  auth: ReturnType<typeof createBetterAuth>,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const url = new URL(request.url, configFallbackUrl(request));
  const headers = requestHeaders(request);
  const payload =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : JSON.stringify(request.body ?? {});
  if (payload) {
    headers.set("content-type", "application/json");
  }
  const response = await auth.handler(
    new Request(
      url,
      payload
        ? { method: request.method, headers, body: payload }
        : { method: request.method, headers },
    ),
  );
  const pathname = url.pathname.replace(/\/$/, "");
  const text = await response.text();
  if (response.status >= 500) {
    return reply.status(500).send(errorBody("CONFLICT", "تعذر إكمال العملية."));
  }
  if (response.status >= 400) {
    return reply.status(401).send(errorBody("UNAUTHENTICATED", "يلزم تسجيل الدخول."));
  }
  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "content-length" || lower === "content-type") {
      return;
    }
    reply.header(key, value);
  });
  reply.status(response.status);
  if (pathname.endsWith("/get-session")) {
    const raw = text ? safeParse(text) : null;
    const authenticated = Boolean(
      raw && typeof raw === "object" && "user" in raw && (raw as { user?: unknown }).user,
    );
    return reply.send({ authenticated });
  }
  return reply.send({ ok: true });
}

function sanitizePoolError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return `PostgreSQL pool error: ${raw.replace(/postgres:\/\/[^@\s]+@/gi, "postgres://***@")}`;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function configFallbackUrl(request: FastifyRequest): string {
  const host = request.headers.host ?? "127.0.0.1";
  return `http://${host}`;
}

function requestHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

function asObject(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

async function handle(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (error) {
    return sendError(reply, error);
  }
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof UnauthenticatedError) {
    return reply.status(401).send(errorBody(error.code, error.message));
  }
  if (error instanceof ForbiddenError) {
    return reply.status(403).send(errorBody(error.code, error.message));
  }
  if (error instanceof BranchNotAuthorizedError) {
    return reply.status(403).send(errorBody(error.code, error.message));
  }
  if (error instanceof DuplicateLoginNameError) {
    return reply.status(409).send(errorBody(error.code, error.message));
  }
  if (error instanceof DuplicateProductCodeError) {
    return reply.status(409).send(errorBody(error.code, error.message));
  }
  if (error instanceof IdentityValidationError || error instanceof CatalogValidationError) {
    return reply.status(400).send(errorBody(error.code, error.message));
  }
  if (error instanceof InvalidRecoveryError) {
    return reply.status(400).send(errorBody(error.code, error.message));
  }
  if (error instanceof NotFoundError) {
    return reply.status(404).send(errorBody(error.code, error.message));
  }
  return reply.status(500).send(errorBody("CONFLICT", "تعذر إكمال العملية."));
}

function errorBody(code: string, messageAr: string) {
  return { error: { code, messageAr } };
}

export type AppConfig = {
  nodeEnv: string;
  databaseUrl: string;
  authSecret: string;
  authBaseUrl: string;
  internalOrigin: string;
  publicOrigin: string;
  trustedOrigins: string[];
  secureCookies: boolean;
  loopbackRehearsal?: boolean;
  ownerRecoveryAdapter: string | undefined;
  ownerRecoveryOutboxDir: string | undefined;
  publicOrderingEnabled?: boolean;
  productMediaDir?: string;
  databasePoolMax?: number;
  businessClock?: () => Date;
};

const LOOPBACK_AUTH_ORIGIN = "http://127.0.0.1:3010";
const LOOPBACK_INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const LOOPBACK_PUBLIC_ORIGIN = "http://127.0.0.1:3000";
const BETTER_AUTH_DEFAULT_SECRET = "better-auth-secret-12345678901234567890";
const EXAMPLE_LOCAL_SECRET = "replace-with-a-long-local-secret";
const EXAMPLE_RANDOM_SECRET = "replace-with-a-long-random-secret";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const production = nodeEnv === "production";
  const loopbackRehearsal = booleanSetting(
    env.BRAVOS_LOOPBACK_REHEARSAL,
    "BRAVOS_LOOPBACK_REHEARSAL",
    false,
  );
  const extraOrigins = (env.BRAVOS_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const allowLoopbackDefaults = !production || loopbackRehearsal;
  const internalOrigin = allowLoopbackDefaults
    ? env.BRAVOS_INTERNAL_ORIGIN ?? LOOPBACK_INTERNAL_ORIGIN
    : requiredCanonicalHttpsOrigin(env.BRAVOS_INTERNAL_ORIGIN, "BRAVOS_INTERNAL_ORIGIN");
  const publicOrigin = allowLoopbackDefaults
    ? env.BRAVOS_PUBLIC_ORIGIN ?? LOOPBACK_PUBLIC_ORIGIN
    : requiredCanonicalHttpsOrigin(env.BRAVOS_PUBLIC_ORIGIN, "BRAVOS_PUBLIC_ORIGIN");
  const authBaseUrl = allowLoopbackDefaults
    ? env.BETTER_AUTH_URL ?? env.BRAVOS_API_ORIGIN ?? LOOPBACK_AUTH_ORIGIN
    : requiredProductionAuthOrigin(env);

  if (loopbackRehearsal && (
    nodeEnv !== "production"
    || authBaseUrl !== LOOPBACK_AUTH_ORIGIN
    || internalOrigin !== LOOPBACK_INTERNAL_ORIGIN
    || publicOrigin !== LOOPBACK_PUBLIC_ORIGIN
    || extraOrigins.length > 0
  )) {
    throw new Error("BRAVOS_LOOPBACK_REHEARSAL is restricted to the fixed production-build loopback origins.");
  }

  return {
    nodeEnv,
    databaseUrl: required(env.DATABASE_URL, "DATABASE_URL"),
    authSecret: production
      ? productionAuthSecret(env.BETTER_AUTH_SECRET)
      : required(env.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET"),
    authBaseUrl,
    internalOrigin,
    publicOrigin,
    trustedOrigins: unique([internalOrigin, authBaseUrl, ...extraOrigins]),
    secureCookies: loopbackRehearsal ? false : env.BRAVOS_SECURE_COOKIES === "true" || nodeEnv === "production",
    loopbackRehearsal,
    ownerRecoveryAdapter: env.BRAVOS_OWNER_RECOVERY_ADAPTER,
    ownerRecoveryOutboxDir: env.BRAVOS_OWNER_RECOVERY_OUTBOX_DIR,
    publicOrderingEnabled: booleanSetting(
      env.BRAVOS_PUBLIC_ORDERING_ENABLED,
      "BRAVOS_PUBLIC_ORDERING_ENABLED",
      nodeEnv !== "production",
    ),
    productMediaDir: production
      ? required(env.BRAVOS_PRODUCT_MEDIA_DIR, "BRAVOS_PRODUCT_MEDIA_DIR")
      : env.BRAVOS_PRODUCT_MEDIA_DIR ?? ".local/product-media",
  };
}

function booleanSetting(value: string | undefined, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be exactly true or false.`);
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

// Length, default, and placeholder checks are exact rejections. They do not prove randomness.
function productionAuthSecret(value: string | undefined): string {
  if (!value) {
    throw new Error("BETTER_AUTH_SECRET is required.");
  }
  if (value.trim() === "") {
    throw new Error("BETTER_AUTH_SECRET must not be whitespace-only.");
  }
  if (value === BETTER_AUTH_DEFAULT_SECRET) {
    throw new Error("BETTER_AUTH_SECRET must not use the Better Auth default secret.");
  }
  if (value === EXAMPLE_LOCAL_SECRET || value === EXAMPLE_RANDOM_SECRET) {
    throw new Error("BETTER_AUTH_SECRET must not use a committed example placeholder.");
  }
  if (value.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters.");
  }
  return value;
}

function requiredProductionAuthOrigin(env: NodeJS.ProcessEnv): string {
  if (env.BETTER_AUTH_URL !== undefined) {
    return requiredCanonicalHttpsOrigin(env.BETTER_AUTH_URL, "BETTER_AUTH_URL");
  }
  if (env.BRAVOS_API_ORIGIN !== undefined) {
    return requiredCanonicalHttpsOrigin(env.BRAVOS_API_ORIGIN, "BRAVOS_API_ORIGIN");
  }
  throw new Error("BETTER_AUTH_URL or BRAVOS_API_ORIGIN is required.");
}

function requiredCanonicalHttpsOrigin(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  if (!isCanonicalHttpsOrigin(value)) {
    throw new Error(`${name} must be a canonical HTTPS origin.`);
  }
  return value;
}

function isCanonicalHttpsOrigin(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:"
    && parsed.username === ""
    && parsed.password === ""
    && parsed.pathname === "/"
    && parsed.search === ""
    && parsed.hash === ""
    && parsed.hostname !== ""
    && !parsed.hostname.includes("*")
    && value === parsed.origin;
}

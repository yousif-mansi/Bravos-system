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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const internalOrigin = env.BRAVOS_INTERNAL_ORIGIN ?? "http://127.0.0.1:5173";
  const publicOrigin = env.BRAVOS_PUBLIC_ORIGIN ?? "http://127.0.0.1:3000";
  const authBaseUrl = env.BETTER_AUTH_URL ?? env.BRAVOS_API_ORIGIN ?? "http://127.0.0.1:3010";
  const loopbackRehearsal = booleanSetting(
    env.BRAVOS_LOOPBACK_REHEARSAL,
    "BRAVOS_LOOPBACK_REHEARSAL",
    false,
  );
  const extraOrigins = (env.BRAVOS_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (loopbackRehearsal && (
    nodeEnv !== "production"
    || authBaseUrl !== "http://127.0.0.1:3010"
    || internalOrigin !== "http://127.0.0.1:5173"
    || publicOrigin !== "http://127.0.0.1:3000"
    || extraOrigins.length > 0
  )) {
    throw new Error("BRAVOS_LOOPBACK_REHEARSAL is restricted to the fixed production-build loopback origins.");
  }
  return {
    nodeEnv,
    databaseUrl: required(env.DATABASE_URL, "DATABASE_URL"),
    authSecret: required(env.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET"),
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
    productMediaDir: nodeEnv === "production"
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

export type AppConfig = {
  nodeEnv: string;
  databaseUrl: string;
  authSecret: string;
  authBaseUrl: string;
  internalOrigin: string;
  publicOrigin: string;
  trustedOrigins: string[];
  secureCookies: boolean;
  ownerRecoveryAdapter: string | undefined;
  ownerRecoveryOutboxDir: string | undefined;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const internalOrigin = env.BRAVOS_INTERNAL_ORIGIN ?? "http://127.0.0.1:5173";
  const publicOrigin = env.BRAVOS_PUBLIC_ORIGIN ?? "http://127.0.0.1:3000";
  const authBaseUrl = env.BETTER_AUTH_URL ?? env.BRAVOS_API_ORIGIN ?? "http://127.0.0.1:3010";
  const extraOrigins = (env.BRAVOS_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    nodeEnv,
    databaseUrl: required(env.DATABASE_URL, "DATABASE_URL"),
    authSecret: required(env.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET"),
    authBaseUrl,
    internalOrigin,
    publicOrigin,
    trustedOrigins: unique([internalOrigin, authBaseUrl, ...extraOrigins]),
    secureCookies: env.BRAVOS_SECURE_COOKIES === "true" || nodeEnv === "production",
    ownerRecoveryAdapter: env.BRAVOS_OWNER_RECOVERY_ADAPTER,
    ownerRecoveryOutboxDir: env.BRAVOS_OWNER_RECOVERY_OUTBOX_DIR,
  };
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

import { expect, test } from "vitest";
import { loadConfig } from "../../apps/api/src/config.ts";

const PRODUCTION_SECRET = "operator-secret-operator-secret-32";
const MEDIA_DIR = "C:/BravosPrivate/media";
const BETTER_AUTH_DEFAULT_SECRET = "better-auth-secret-12345678901234567890";
const EXAMPLE_LOCAL_SECRET = "replace-with-a-long-local-secret";
const EXAMPLE_RANDOM_SECRET = "replace-with-a-long-random-secret";

function hostedProduction(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://operator@example/bravos",
    BETTER_AUTH_SECRET: PRODUCTION_SECRET,
    BRAVOS_PRODUCT_MEDIA_DIR: MEDIA_DIR,
    BETTER_AUTH_URL: "https://api.example",
    BRAVOS_INTERNAL_ORIGIN: "https://staff.example",
    BRAVOS_PUBLIC_ORIGIN: "https://shop.example",
    ...overrides,
  };
}

function rehearsalProduction(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://operator@example/bravos",
    BETTER_AUTH_SECRET: PRODUCTION_SECRET,
    BRAVOS_PRODUCT_MEDIA_DIR: MEDIA_DIR,
    BRAVOS_LOOPBACK_REHEARSAL: "true",
    BETTER_AUTH_URL: "http://127.0.0.1:3010",
    BRAVOS_INTERNAL_ORIGIN: "http://127.0.0.1:5173",
    BRAVOS_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
    ...overrides,
  };
}

test("hosted production accepts explicit canonical HTTPS origins and API-origin fallback", () => {
  const loaded = loadConfig(hostedProduction());
  expect(loaded).toMatchObject({
    nodeEnv: "production",
    databaseUrl: "postgres://operator@example/bravos",
    authSecret: PRODUCTION_SECRET,
    authBaseUrl: "https://api.example",
    internalOrigin: "https://staff.example",
    publicOrigin: "https://shop.example",
    trustedOrigins: ["https://staff.example", "https://api.example"],
    publicOrderingEnabled: false,
    secureCookies: true,
    loopbackRehearsal: false,
    productMediaDir: MEDIA_DIR,
  });

  const env = hostedProduction({ BRAVOS_API_ORIGIN: "https://api.example:8443" });
  delete env.BETTER_AUTH_URL;
  expect(loadConfig(env).authBaseUrl).toBe("https://api.example:8443");

  expect(loadConfig(hostedProduction({
    BETTER_AUTH_URL: "https://auth.example",
    BRAVOS_API_ORIGIN: "https://api.example",
  })).authBaseUrl).toBe("https://auth.example");
});

test("production preserves an accepted authentication secret verbatim", () => {
  const secret = "  accepted-production-secret-val";
  expect(secret).toHaveLength(32);
  const loaded = loadConfig(hostedProduction({ BETTER_AUTH_SECRET: secret }));
  expect(loaded.authSecret).toBe(secret);
  expect(loaded.authSecret.startsWith("  ")).toBe(true);
});

test("production rejects missing, whitespace, default, example, and short secrets without leaking the value", () => {
  const missing = hostedProduction();
  delete missing.BETTER_AUTH_SECRET;
  expect(() => loadConfig(missing)).toThrow(/BETTER_AUTH_SECRET is required/);
  expect(() => loadConfig(hostedProduction({ BETTER_AUTH_SECRET: "" }))).toThrow(/BETTER_AUTH_SECRET is required/);

  for (const [label, secret, pattern] of [
    ["spaces", "                                ", /BETTER_AUTH_SECRET must not be whitespace-only/],
    ["tabs", "\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t", /BETTER_AUTH_SECRET must not be whitespace-only/],
    ["default", BETTER_AUTH_DEFAULT_SECRET, /BETTER_AUTH_SECRET must not use the Better Auth default secret/],
    ["local example", EXAMPLE_LOCAL_SECRET, /BETTER_AUTH_SECRET must not use a committed example placeholder/],
    ["random example", EXAMPLE_RANDOM_SECRET, /BETTER_AUTH_SECRET must not use a committed example placeholder/],
    ["31 characters", "a".repeat(31), /BETTER_AUTH_SECRET must be at least 32 characters/],
  ] as const) {
    expect(() => loadConfig(hostedProduction({ BETTER_AUTH_SECRET: secret })), label).toThrow(pattern);
    try {
      loadConfig(hostedProduction({ BETTER_AUTH_SECRET: secret }));
      throw new Error(`${label} was accepted`);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  }

  const accepted = "b".repeat(32);
  expect(loadConfig(hostedProduction({ BETTER_AUTH_SECRET: accepted })).authSecret).toBe(accepted);
});

test("hosted production rejects missing, empty, malformed, non-HTTPS, and noncanonical origins", () => {
  const missingInternal = hostedProduction();
  delete missingInternal.BRAVOS_INTERNAL_ORIGIN;
  expect(() => loadConfig(missingInternal)).toThrow(/BRAVOS_INTERNAL_ORIGIN is required/);

  const missingPublic = hostedProduction();
  delete missingPublic.BRAVOS_PUBLIC_ORIGIN;
  expect(() => loadConfig(missingPublic)).toThrow(/BRAVOS_PUBLIC_ORIGIN is required/);

  const missingAuth = hostedProduction();
  delete missingAuth.BETTER_AUTH_URL;
  expect(() => loadConfig(missingAuth)).toThrow(/BETTER_AUTH_URL or BRAVOS_API_ORIGIN is required/);

  expect(() => loadConfig(hostedProduction({ BRAVOS_INTERNAL_ORIGIN: "" }))).toThrow(/BRAVOS_INTERNAL_ORIGIN is required/);
  expect(() => loadConfig(hostedProduction({ BRAVOS_PUBLIC_ORIGIN: "" }))).toThrow(/BRAVOS_PUBLIC_ORIGIN is required/);
  expect(() => loadConfig(hostedProduction({ BETTER_AUTH_URL: "" }))).toThrow(/BETTER_AUTH_URL is required/);

  const emptyApiOrigin = hostedProduction({ BRAVOS_API_ORIGIN: "" });
  delete emptyApiOrigin.BETTER_AUTH_URL;
  expect(() => loadConfig(emptyApiOrigin)).toThrow(/BRAVOS_API_ORIGIN is required/);

  for (const [label, origin] of [
    ["malformed", "not-a-url"],
    ["empty host", "https://"],
    ["http", "http://shop.example"],
    ["loopback http", "http://127.0.0.1:3000"],
    ["userinfo", "https://user:pass@shop.example"],
    ["path", "https://shop.example/admin"],
    ["query", "https://shop.example?x=1"],
    ["fragment", "https://shop.example#x"],
    ["wildcard host", "https://*.example"],
    ["wildcard only", "https://*"],
    ["trailing slash", "https://shop.example/"],
    ["default https port", "https://shop.example:443"],
    ["uppercase scheme", "HTTPS://shop.example"],
    ["leading space", " https://shop.example"],
    ["whitespace", "   "],
  ] as const) {
    expect(() => loadConfig(hostedProduction({ BRAVOS_INTERNAL_ORIGIN: origin })), `internal ${label}`).toThrow(
      /BRAVOS_INTERNAL_ORIGIN must be a canonical HTTPS origin/,
    );
    expect(() => loadConfig(hostedProduction({ BRAVOS_PUBLIC_ORIGIN: origin })), `public ${label}`).toThrow(
      /BRAVOS_PUBLIC_ORIGIN must be a canonical HTTPS origin/,
    );
    expect(() => loadConfig(hostedProduction({ BETTER_AUTH_URL: origin })), `auth ${label}`).toThrow(
      /BETTER_AUTH_URL must be a canonical HTTPS origin/,
    );
    const apiOriginEnv = hostedProduction({ BRAVOS_API_ORIGIN: origin });
    delete apiOriginEnv.BETTER_AUTH_URL;
    expect(() => loadConfig(apiOriginEnv), `api ${label}`).toThrow(
      /BRAVOS_API_ORIGIN must be a canonical HTTPS origin/,
    );
  }

  const customPort = loadConfig(hostedProduction({
    BETTER_AUTH_URL: "https://api.example:8443",
    BRAVOS_INTERNAL_ORIGIN: "https://staff.example:8443",
    BRAVOS_PUBLIC_ORIGIN: "https://shop.example:8443",
  }));
  expect(customPort.authBaseUrl).toBe("https://api.example:8443");
  expect(customPort.internalOrigin).toBe("https://staff.example:8443");
  expect(customPort.publicOrigin).toBe("https://shop.example:8443");
});

test("development and test keep loopback defaults and nonempty-secret behavior", () => {
  const development = loadConfig({
    DATABASE_URL: "postgres://bravos:bravos-test@127.0.0.1:54329/bravos",
    BETTER_AUTH_SECRET: "short",
  });
  expect(development).toMatchObject({
    nodeEnv: "development",
    authSecret: "short",
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: "http://127.0.0.1:5173",
    publicOrigin: "http://127.0.0.1:3000",
    trustedOrigins: ["http://127.0.0.1:5173", "http://127.0.0.1:3010"],
    publicOrderingEnabled: true,
    secureCookies: false,
    loopbackRehearsal: false,
    productMediaDir: ".local/product-media",
  });

  const testEnv = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://bravos:bravos-test@127.0.0.1:54329/bravos",
    BETTER_AUTH_SECRET: EXAMPLE_LOCAL_SECRET,
    BETTER_AUTH_URL: "http://127.0.0.1:3010",
  });
  expect(testEnv).toMatchObject({
    nodeEnv: "test",
    authSecret: EXAMPLE_LOCAL_SECRET,
    authBaseUrl: "http://127.0.0.1:3010",
    publicOrderingEnabled: true,
    secureCookies: false,
  });

  expect(() => loadConfig({
    DATABASE_URL: "postgres://bravos:bravos-test@127.0.0.1:54329/bravos",
  })).toThrow(/BETTER_AUTH_SECRET is required/);
});

test("loopback rehearsal keeps fixed HTTP origins, validates the secret, and refuses other environments", () => {
  const withDefaults = rehearsalProduction();
  delete withDefaults.BETTER_AUTH_URL;
  delete withDefaults.BRAVOS_INTERNAL_ORIGIN;
  delete withDefaults.BRAVOS_PUBLIC_ORIGIN;
  expect(loadConfig(withDefaults)).toMatchObject({
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: "http://127.0.0.1:5173",
    publicOrigin: "http://127.0.0.1:3000",
    trustedOrigins: ["http://127.0.0.1:5173", "http://127.0.0.1:3010"],
    secureCookies: false,
    loopbackRehearsal: true,
    publicOrderingEnabled: false,
  });

  expect(loadConfig(rehearsalProduction()).loopbackRehearsal).toBe(true);
  expect(() => loadConfig(rehearsalProduction({ BETTER_AUTH_SECRET: "short" }))).toThrow(
    /BETTER_AUTH_SECRET must be at least 32 characters/,
  );
  expect(() => loadConfig(rehearsalProduction({ BETTER_AUTH_SECRET: EXAMPLE_RANDOM_SECRET }))).toThrow(
    /BETTER_AUTH_SECRET must not use a committed example placeholder/,
  );

  expect(() => loadConfig(rehearsalProduction({ NODE_ENV: "development" }))).toThrow(
    /fixed production-build loopback origins/,
  );
  expect(() => loadConfig(rehearsalProduction({ NODE_ENV: "test" }))).toThrow(
    /fixed production-build loopback origins/,
  );
  expect(() => loadConfig(rehearsalProduction({ BRAVOS_PUBLIC_ORIGIN: "http://localhost:3000" }))).toThrow(
    /fixed production-build loopback origins/,
  );
  expect(() => loadConfig(rehearsalProduction({ BRAVOS_INTERNAL_ORIGIN: "http://127.0.0.1:5174" }))).toThrow(
    /fixed production-build loopback origins/,
  );
  expect(() => loadConfig(rehearsalProduction({ BETTER_AUTH_URL: "http://127.0.0.1:3011" }))).toThrow(
    /fixed production-build loopback origins/,
  );
  expect(() => loadConfig(rehearsalProduction({ BRAVOS_TRUSTED_ORIGINS: "http://127.0.0.1:5173" }))).toThrow(
    /fixed production-build loopback origins/,
  );
  expect(() => loadConfig(rehearsalProduction({ BRAVOS_LOOPBACK_REHEARSAL: "yes" }))).toThrow(
    /BRAVOS_LOOPBACK_REHEARSAL must be exactly true or false/,
  );
  expect(() => loadConfig(hostedProduction({ BRAVOS_PUBLIC_ORDERING_ENABLED: "TRUE" }))).toThrow(
    /BRAVOS_PUBLIC_ORDERING_ENABLED must be exactly true or false/,
  );
});

test("production cookie, ordering, media, and trusted-origin parsing stay on existing rules", () => {
  expect(loadConfig(hostedProduction()).secureCookies).toBe(true);
  expect(loadConfig(hostedProduction({ BRAVOS_SECURE_COOKIES: "false" })).secureCookies).toBe(true);
  expect(loadConfig(hostedProduction()).publicOrderingEnabled).toBe(false);
  expect(loadConfig(hostedProduction({ BRAVOS_PUBLIC_ORDERING_ENABLED: "true" })).publicOrderingEnabled).toBe(true);
  expect(loadConfig(hostedProduction({ BRAVOS_PUBLIC_ORDERING_ENABLED: "false" })).publicOrderingEnabled).toBe(false);

  const missingMedia = hostedProduction();
  delete missingMedia.BRAVOS_PRODUCT_MEDIA_DIR;
  expect(() => loadConfig(missingMedia)).toThrow(/BRAVOS_PRODUCT_MEDIA_DIR is required/);

  expect(loadConfig(hostedProduction({
    BRAVOS_TRUSTED_ORIGINS: " https://extra.example ,https://extra.example,https://other.example,https://*.cdn.example",
  })).trustedOrigins).toEqual([
    "https://staff.example",
    "https://api.example",
    "https://extra.example",
    "https://other.example",
    "https://*.cdn.example",
  ]);
});

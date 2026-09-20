// Runs in a child process with NODE_ENV=production so Better Auth enables its production rate limiter.
import { buildApp } from "../../../apps/api/src/app.ts";
import { ensureOwner } from "../../../apps/api/src/bootstrap.ts";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const built = await buildApp({
  nodeEnv: "production",
  databaseUrl: process.env.DATABASE_URL!,
  authSecret: "prod-secret-prod-secret-prod-secret-32",
  authBaseUrl: "http://127.0.0.1:3010",
  internalOrigin: INTERNAL_ORIGIN,
  publicOrigin: "http://127.0.0.1:3000",
  trustedOrigins: [INTERNAL_ORIGIN, "http://127.0.0.1:3010"],
  secureCookies: false,
  ownerRecoveryAdapter: "operator-file",
  ownerRecoveryOutboxDir: process.env.BRAVOS_OWNER_RECOVERY_OUTBOX_DIR!,
  productMediaDir: process.env.BRAVOS_PRODUCT_MEDIA_DIR!,
  publicOrderingEnabled: false,
});
try {
  await ensureOwner(built.services, { loginName: "owner", displayName: "مالك برافوس", password: "owner-pass-1" });
  const signIn = (remoteAddress: string, spoofedForwardedFor?: string) => built.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/username",
    remoteAddress,
    headers: {
      origin: INTERNAL_ORIGIN,
      "content-type": "application/json",
      ...(spoofedForwardedFor ? { "x-forwarded-for": spoofedForwardedFor, "x-bravos-client-ip": spoofedForwardedFor } : {}),
    },
    payload: { username: "owner", password: "owner-pass-1" },
  });
  const separateClients = [];
  for (const address of ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"]) {
    separateClients.push((await signIn(address)).statusCode);
  }
  const sameClient = [];
  let limited: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await signIn("10.0.0.9", `198.51.100.${attempt + 1}`);
    sameClient.push(response.statusCode);
    if (response.statusCode >= 400) limited = response.json();
  }
  process.stdout.write(JSON.stringify({ separateClients, sameClient, limited }));
} finally {
  await built.close();
}

import { betterAuth } from "better-auth";
import { admin, username } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import type { Pool } from "pg";
import type { StaffRole } from "@bravos/contracts";
import { isAllowedLoginName, normalizeLoginName } from "../domain/login-name.ts";
import type { IdentityProvider, VerifiedAuth } from "../application/ports.ts";
import { provisionStaffGraph } from "./postgres-directory.ts";

export type BetterAuthOptions = {
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  secureCookies: boolean;
};

export function createBetterAuth(pool: Pool, options: BetterAuthOptions) {
  return betterAuth({
    appName: "BRAVOS",
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
    database: pool,
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
    },
    disabledPaths: [
      "/sign-up/email",
      "/sign-in/email",
      "/request-password-reset",
      "/reset-password",
      "/is-username-available",
      "/change-email",
      "/delete-user",
      "/update-user",
      "/change-password",
      "/admin/create-user",
      "/admin/list-users",
      "/admin/set-role",
      "/admin/ban-user",
      "/admin/unban-user",
      "/admin/impersonate-user",
      "/admin/stop-impersonating",
      "/admin/remove-user",
      "/admin/set-user-password",
    ],
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 30,
        usernameValidator: isAllowedLoginName,
        usernameNormalization: normalizeLoginName,
        immutableUsername: true,
      }),
      admin({
        defaultRole: "staff",
        adminRoles: ["manager"],
        roles: {
          manager: adminAc,
          staff: userAc,
        },
      }),
    ],
    session: {
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 60,
    },
    advanced: {
      // The API sets this header from the connection address; client-supplied forwarding headers are not trusted.
      ipAddress: { ipAddressHeaders: ["x-bravos-client-ip"] },
      useSecureCookies: options.secureCookies,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: options.secureCookies,
        path: "/",
      },
      cookies: {
        session_token: {
          attributes: {
            httpOnly: true,
            sameSite: "lax",
            secure: options.secureCookies,
            path: "/",
          },
        },
      },
      generateId: () => crypto.randomUUID(),
      database: {
        generateId: "uuid",
      },
    },
  });
}

export type AuthInstance = ReturnType<typeof createBetterAuth>;

export async function awaitAuthReady(auth: AuthInstance): Promise<void> {
  const ctx = await auth.$context;
  const checkSchema = (ctx as { checkSchema?: () => Promise<unknown> }).checkSchema;
  if (typeof checkSchema === "function") {
    await checkSchema();
  }
}

type AuthContext = Awaited<AuthInstance["$context"]>;

export type IdentityGateway = IdentityProvider & {
  getVerifiedAuth(cookieHeader: string): Promise<VerifiedAuth | null>;
};

function internalEmailFor(staffId: string): string {
  return `${staffId}@staff.bravos.invalid`;
}

export function createBetterAuthIdentityProvider(
  auth: AuthInstance,
  pool: Pool,
): IdentityGateway {
  async function context(): Promise<AuthContext> {
    return auth.$context;
  }

  return {
    async hashPassword(password) {
      const ctx = await context();
      return ctx.password.hash(password);
    },

    async createAccount(input) {
      const passwordHash = await this.hashPassword(input.password);
      const staffId = crypto.randomUUID();
      await provisionStaffGraph(pool, {
        staffId,
        loginName: input.loginName,
        displayName: input.displayName,
        internalEmail: internalEmailFor(staffId),
        role: input.role,
        passwordHash,
        isOwner: input.isOwner,
        grants: input.grants,
        actorStaffId: input.actorStaffId,
      });
      return { id: staffId };
    },

    async getVerifiedAuth(cookieHeader) {
      const headers = new Headers();
      if (cookieHeader) {
        headers.set("cookie", cookieHeader);
      }
      const session = await auth.api.getSession({ headers });
      if (!session?.user || !session.session) {
        return null;
      }
      return {
        staffId: session.user.id,
        sessionId: session.session.id,
      };
    },
  };
}

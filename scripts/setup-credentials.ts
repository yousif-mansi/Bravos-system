import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";

export type PreviousSetupCredentials = {
  ownerLogin?: string;
  ownerPassword?: string;
  cashierLogin?: string;
  cashierPassword?: string;
};

export type SetupPasswordState = "verified" | "unknown";

export type RecordedSetupCredentials = {
  ownerLogin: string;
  cashierLogin: string;
  ownerPassword?: string;
  cashierPassword?: string;
  ownerPasswordState: SetupPasswordState;
  cashierPasswordState: SetupPasswordState;
};

export function passwordCandidate(input: {
  created: boolean;
  createdPassword?: string;
  supplied?: string;
  requestedLogin: string;
  previousLogin?: string;
  previousPassword?: string;
}): { password?: string; source: "created" | "supplied" | "preserved" | "none" } {
  if (input.created) {
    return { password: input.createdPassword, source: "created" };
  }
  if (input.supplied) {
    return { password: input.supplied, source: "supplied" };
  }
  if (
    input.previousLogin &&
    input.previousPassword &&
    input.previousLogin.toLowerCase() === input.requestedLogin.toLowerCase()
  ) {
    return { password: input.previousPassword, source: "preserved" };
  }
  return { password: undefined, source: "none" };
}

export async function recordVerifiedSetupCredentials(input: {
  app: FastifyInstance;
  origin: string;
  credentialsPath: string;
  ownerLogin: string;
  cashierLogin: string;
  ownerCreated: boolean;
  cashierCreated: boolean;
  createdOwnerPassword?: string;
  createdCashierPassword?: string;
  suppliedOwnerPassword?: string;
  suppliedCashierPassword?: string;
  previous: PreviousSetupCredentials;
}): Promise<RecordedSetupCredentials> {
  const ownerCandidate = passwordCandidate({
    created: input.ownerCreated,
    createdPassword: input.createdOwnerPassword,
    supplied: input.suppliedOwnerPassword,
    requestedLogin: input.ownerLogin,
    previousLogin: input.previous.ownerLogin,
    previousPassword: input.previous.ownerPassword,
  });
  const cashierCandidate = passwordCandidate({
    created: input.cashierCreated,
    createdPassword: input.createdCashierPassword,
    supplied: input.suppliedCashierPassword,
    requestedLogin: input.cashierLogin,
    previousLogin: input.previous.cashierLogin,
    previousPassword: input.previous.cashierPassword,
  });

  const owner = await resolveAccountPassword({
    app: input.app,
    origin: input.origin,
    loginName: input.ownerLogin,
    candidate: ownerCandidate.password,
    source: ownerCandidate.source,
    accountLabel: "owner",
  });
  const cashier = await resolveAccountPassword({
    app: input.app,
    origin: input.origin,
    loginName: input.cashierLogin,
    candidate: cashierCandidate.password,
    source: cashierCandidate.source,
    accountLabel: "demo cashier",
  });

  await mkdir(path.dirname(input.credentialsPath), { recursive: true });
  await writeFile(
    input.credentialsPath,
    [
      "BRAVOS labeled local demo credentials. Disposable. Do not use in production.",
      `owner login: ${input.ownerLogin}`,
      `owner password: ${owner.password ?? "unknown"}`,
      `demo cashier login: ${input.cashierLogin}`,
      `demo cashier password: ${cashier.password ?? "unknown"}`,
      "branches: أبشواي، الفيوم",
      "Owner recovery delivery for local development is documented in docs/development/local-setup.md.",
      "",
    ].join("\n"),
    "utf8",
  );

  return {
    ownerLogin: input.ownerLogin,
    cashierLogin: input.cashierLogin,
    ownerPassword: owner.password,
    cashierPassword: cashier.password,
    ownerPasswordState: owner.state,
    cashierPasswordState: cashier.state,
  };
}

async function resolveAccountPassword(input: {
  app: FastifyInstance;
  origin: string;
  loginName: string;
  candidate?: string;
  source: "created" | "supplied" | "preserved" | "none";
  accountLabel: string;
}): Promise<{ password?: string; state: SetupPasswordState }> {
  if (!input.candidate) {
    return { password: undefined, state: "unknown" };
  }
  const accepted = await canSignIn(
    input.app,
    input.origin,
    input.loginName,
    input.candidate,
    input.accountLabel,
  );
  if (accepted) {
    return { password: input.candidate, state: "verified" };
  }
  if (input.source === "supplied") {
    throw new Error(
      `The supplied ${input.accountLabel} password does not match the existing ${input.accountLabel} account.`,
    );
  }
  if (input.source === "created") {
    throw new Error(`Newly created ${input.accountLabel} could not sign in with the recorded password.`);
  }
  return { password: undefined, state: "unknown" };
}

async function canSignIn(
  app: FastifyInstance,
  origin: string,
  username: string,
  password: string,
  accountLabel: string,
): Promise<boolean> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/username",
    headers: {
      origin,
      "content-type": "application/json",
    },
    payload: { username, password },
  });
  if (response.statusCode === 200) {
    return true;
  }
  const body = parseJsonBody(response.body);
  const errorCode =
    body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object"
      ? (body.error as { code?: unknown }).code
      : undefined;
  if (response.statusCode === 401 && errorCode === "UNAUTHENTICATED") {
    return false;
  }
  const detail = typeof errorCode === "string" ? ` (${errorCode})` : "";
  throw new Error(
    `Could not verify ${accountLabel} credentials: unexpected status ${response.statusCode}${detail}`,
  );
}

function parseJsonBody(body: string): unknown {
  if (!body) {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

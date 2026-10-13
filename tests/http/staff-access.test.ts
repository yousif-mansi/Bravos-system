import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { applyMigrations } from "@bravos/persistence";
import {
  assertOperatorRecoveryDirectory,
  createOperatorRecoveryOutbox,
  protectOperatorSecretFile,
} from "@bravos/identity/node";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";
const EVIL_ORIGIN = "http://evil.example";
const execFileAsync = promisify(execFile);

let cluster: PostgresCluster;
let databaseName = "bravos_http_1";
let outboxDir: string;
let built: BuiltApp;
let abshwayId = "";
let fayoumId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: Number(process.env.BRAVOS_STAFF_TEST_PORT ?? 55432) });
}, 120_000);

afterAll(async () => {
  if (built) {
    await built.close();
  }
  await cluster.stop();
});

beforeEach(async () => {
  if (built) {
    await built.close();
  }
  databaseName = `bravos_http_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  outboxDir = await mkdtemp(path.join(tmpdir(), "bravos-outbox-"));
  built = await buildApp({
    nodeEnv: "test",
    databaseUrl: cluster.connectionString(databaseName),
    authSecret: "test-secret-test-secret-test-secret-32",
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: INTERNAL_ORIGIN,
    publicOrigin: PUBLIC_ORIGIN,
    trustedOrigins: [INTERNAL_ORIGIN, "http://127.0.0.1:3010"],
    secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: outboxDir,
  });
  await applyMigrations(built.pool);
  const branches = await built.pool.query<{ id: string; code: string }>(
    "SELECT id, code FROM branch ORDER BY code",
  );
  abshwayId = branches.rows.find((row) => row.code === "abshway")?.id ?? "";
  fayoumId = branches.rows.find((row) => row.code === "fayoum")?.id ?? "";
  await ensureOwner(built.services, {
    loginName: "owner",
    displayName: "مالك برافوس",
    password: "owner-pass-1",
  });
});

test("manager creates a staff account without an email", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const created = await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.ahmed",
    displayName: "أحمد الكاشير",
    password: "staff-pass-1",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({
    loginName: "cashier.ahmed",
    displayName: "أحمد الكاشير",
    role: "employee",
    disabled: false,
  });
  expect(created.body).not.toHaveProperty("email");
  expect(JSON.stringify(created.body)).not.toContain(".invalid");
  expect(JSON.stringify(created.body)).not.toContain("password");
});

test("employee logs in and reads only assigned branches", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "noura",
    displayName: "نورة",
    password: "staff-pass-2",
    grants: [{ branchId: fayoumId, cashier: true, orderRepresentative: true }],
  });
  const employee = await signIn("noura", "staff-pass-2");
  const workspace = await api(employee, "GET", "/api/internal/workspace");
  expect(workspace.status).toBe(200);
  expect(workspace.body.authorizedBranches.map((branch: { code: string }) => branch.code)).toEqual([
    "fayoum",
  ]);
  expect(workspace.body.activeBranch).toBeNull();
  const selected = await api(employee, "POST", "/api/internal/active-branch", {
    branchId: fayoumId,
  });
  expect(selected.status).toBe(200);
  expect(selected.body.activeBranch.code).toBe("fayoum");
});

test("forged branch, role and manager action headers are denied", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier",
    displayName: "كاشير",
    password: "staff-pass-3",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const employee = await signIn("cashier", "staff-pass-3");
  const forgedBranch = await api(employee, "POST", "/api/internal/active-branch", {
    branchId: fayoumId,
  }, {
    extraHeaders: {
      "x-branch-id": fayoumId,
      "x-role": "manager",
      "x-actor-id": "owner",
    },
  });
  expect(forgedBranch.status).toBe(403);
  expect(forgedBranch.body.error.code).toBe("BRANCH_NOT_AUTHORIZED");
  const forgedStaff = await api(employee, "GET", "/api/internal/staff", undefined, {
    extraHeaders: { "x-role": "manager" },
  });
  expect(forgedStaff.status).toBe(403);
  const forgedCreate = await api(employee, "POST", "/api/internal/staff", {
    loginName: "intruder",
    displayName: "متطفل",
    password: "staff-pass-9",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  }, {
    extraHeaders: { "x-role": "manager" },
  });
  expect(forgedCreate.status).toBe(403);
});

test("password reset and disable revoke access", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const created = await api(manager, "POST", "/api/internal/staff", {
    loginName: "salem",
    displayName: "سالم",
    password: "staff-pass-4",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const employee = await signIn("salem", "staff-pass-4");
  await api(manager, "POST", `/api/internal/staff/${created.body.id}/reset-password`, {
    password: "staff-pass-4b",
  });
  const oldPassword = await signInResult("salem", "staff-pass-4");
  expectAuthRejected(oldPassword);
  const workspaceAfterReset = await api(employee, "GET", "/api/internal/workspace");
  expect(workspaceAfterReset.status).toBe(401);
  const reLogin = await signIn("salem", "staff-pass-4b");
  expect((await api(reLogin, "GET", "/api/internal/workspace")).status).toBe(200);
  await api(manager, "POST", `/api/internal/staff/${created.body.id}/disable`);
  const disabled = await signInResult("salem", "staff-pass-4b");
  expectAuthRejected(disabled);
  expect((await api(reLogin, "GET", "/api/internal/workspace")).status).toBe(401);
  const stillDisabled = await signInResult("salem", "staff-pass-4b");
  expectAuthRejected(stillDisabled);
});

test("login names are unique after normalization", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const first = await api(manager, "POST", "/api/internal/staff", {
    loginName: "Ahmed",
    displayName: "أحمد",
    password: "staff-pass-5",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  expect(first.status).toBe(201);
  expect(first.body.loginName).toBe("ahmed");
  const duplicate = await api(manager, "POST", "/api/internal/staff", {
    loginName: "AHMED",
    displayName: "أحمد الآخر",
    password: "staff-pass-6",
    grants: [{ branchId: fayoumId, cashier: true, orderRepresentative: false }],
  });
  expect(duplicate.status).toBe(409);
  expect(duplicate.body.error.code).toBe("DUPLICATE_LOGIN_NAME");
});

test("owner recovery uses the local outbox and does not expose the token over HTTP", async () => {
  const requested = await api(undefined, "POST", "/api/internal/owner-recovery/request", {
    loginName: "owner",
  });
  expect(requested.status).toBe(200);
  expect(JSON.stringify(requested.body)).not.toContain("token");
  const delivered = JSON.parse(await readFile(path.join(outboxDir, "latest.json"), "utf8")) as {
    token: string;
    purpose: string;
  };
  expect(delivered.purpose).toBe("owner-recovery");
  const complete = await api(undefined, "POST", "/api/internal/owner-recovery/complete", {
    token: delivered.token,
    password: "owner-pass-2",
  });
  expect(complete.status).toBe(200);
  const oldLogin = await signInResult("owner", "owner-pass-1");
  expectAuthRejected(oldLogin);
  const recovered = await signIn("owner", "owner-pass-2");
  expect((await api(recovered, "GET", "/api/internal/workspace")).status).toBe(200);
  await rm(outboxDir, { recursive: true, force: true });
});

test("public staff signup is disabled", async () => {
  const response = await built.app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: {
      origin: INTERNAL_ORIGIN,
      "content-type": "application/json",
    },
    payload: {
      email: "intruder@example.com",
      password: "password12",
      name: "Intruder",
      username: "intruder",
    },
  });
  expect(response.statusCode).toBe(404);
  expect(response.json().error.code).toBe("NOT_FOUND");
  const created = await built.pool.query<{ id: string }>(
    `SELECT id FROM "user" WHERE email = $1 OR username = $2`,
    ["intruder@example.com", "intruder"],
  );
  expect(created.rows).toHaveLength(0);
});

test("untrusted origin and missing CSRF origin are rejected", async () => {
  const evil = await built.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/username",
    headers: {
      origin: EVIL_ORIGIN,
      "content-type": "application/json",
    },
    payload: { username: "owner", password: "owner-pass-1" },
  });
  expect(evil.statusCode).toBe(403);
  const missing = await built.app.inject({
    method: "POST",
    url: "/api/internal/staff",
    headers: { "content-type": "application/json" },
    payload: {
      loginName: "x",
      displayName: "س",
      password: "password1",
      grants: [],
    },
  });
  expect(missing.statusCode).toBe(403);
});

test("production owner recovery configuration fails closed", async () => {
  await expect(
    buildApp({
      nodeEnv: "production",
      databaseUrl: "postgres://nobody:nobody@127.0.0.1:1/missing",
      authSecret: "prod-secret-prod-secret-prod-secret-32",
      authBaseUrl: "https://staff.example",
      internalOrigin: "https://staff.example",
      publicOrigin: "https://shop.example",
      trustedOrigins: ["https://staff.example"],
      secureCookies: true,
      ownerRecoveryAdapter: "local-outbox",
      ownerRecoveryOutboxDir: outboxDir,
    }),
  ).rejects.toThrow(/fail-closed/i);
});

test("production sign-in limits each client address instead of the whole shop and reports the limit", async () => {
  const limitDatabase = `bravos_http_limit_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(limitDatabase);
  const recoveryDirectory = await mkdtemp(path.join(tmpdir(), "bravos-limit-recovery-"));
  const mediaDirectory = await mkdtemp(path.join(tmpdir(), "bravos-limit-media-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "tests/http/fixtures/production-sign-in-limit.ts"], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: cluster.connectionString(limitDatabase),
        BRAVOS_OWNER_RECOVERY_OUTBOX_DIR: recoveryDirectory,
        BRAVOS_PRODUCT_MEDIA_DIR: mediaDirectory,
      },
      timeout: 90_000,
      maxBuffer: 1024 * 1024,
    });
    const result = JSON.parse(stdout) as { separateClients: number[]; sameClient: number[]; limited: unknown };
    expect(result.separateClients).toEqual([200, 200, 200, 200]);
    expect(result.sameClient).toEqual([200, 200, 200, 429]);
    expect(result.limited).toEqual({
      error: { code: "RATE_LIMITED", messageAr: "محاولات دخول كثيرة. انتظر قليلاً ثم أعد المحاولة." },
    });
  } finally {
    await rm(recoveryDirectory, { recursive: true, force: true });
    await rm(mediaDirectory, { recursive: true, force: true });
  }
}, 120_000);

test("production API requires an explicit external product media directory", async () => {
  const recoveryDirectory = await mkdtemp(path.join(tmpdir(), "bravos-production-recovery-"));
  try {
    await expect(
      buildApp({
        nodeEnv: "production",
        databaseUrl: "postgres://nobody:nobody@127.0.0.1:1/missing",
        authSecret: "prod-secret-prod-secret-prod-secret-32",
        authBaseUrl: "https://staff.example",
        internalOrigin: "https://staff.example",
        publicOrigin: "https://shop.example",
        trustedOrigins: ["https://staff.example"],
        secureCookies: true,
        ownerRecoveryAdapter: "operator-file",
        ownerRecoveryOutboxDir: recoveryDirectory,
      }),
    ).rejects.toThrow(/BRAVOS_PRODUCT_MEDIA_DIR is required/i);
  } finally {
    await rm(recoveryDirectory, { recursive: true, force: true });
  }
});

test("operator recovery writes only through a protected external directory", async () => {
  expect(() => assertOperatorRecoveryDirectory("relative/recovery")).toThrow(/absolute path/i);
  expect(() => assertOperatorRecoveryDirectory(path.join(process.cwd(), ".private-recovery"))).toThrow(/disjoint/i);
  const directory = await mkdtemp(path.join(tmpdir(), "bravos-operator-recovery-"));
  try {
    const recovery = createOperatorRecoveryOutbox(directory);
    expect(recovery.kind).toBe("operator-file");
    await recovery.deliver({
      purpose: "owner-recovery",
      createdAt: "2026-09-16T12:30:00.000Z",
      token: "a".repeat(64),
    });
    const latestPath = path.join(directory, "latest.json");
    const latest = JSON.parse(await readFile(latestPath, "utf8"));
    expect(latest).toEqual({
      purpose: "owner-recovery",
      createdAt: "2026-09-16T12:30:00.000Z",
      token: "a".repeat(64),
    });
    await assertPrivateOperatorPath(directory, "directory");
    await assertPrivateOperatorPath(latestPath, "file");
    const written = (await readdir(directory)).filter((name) => name.startsWith("owner-recovery-"));
    expect(written).toHaveLength(1);
    await assertPrivateOperatorPath(path.join(directory, written[0]!), "file");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("operator secret files must be protected regular files outside the workspace", async () => {
  await expect(protectOperatorSecretFile("relative-owner-password.txt")).rejects.toThrow(/absolute path/i);
  await expect(protectOperatorSecretFile(path.join(process.cwd(), "owner-password.txt"))).rejects.toThrow(/disjoint/i);

  const directory = await mkdtemp(path.join(tmpdir(), "bravos-operator-secret-"));
  const passwordFile = path.join(directory, "owner-password.txt");
  try {
    await writeFile(passwordFile, "owner-pass-1\n", "utf8");
    await expect(protectOperatorSecretFile(directory)).rejects.toThrow(/regular file/i);
    expect(await protectOperatorSecretFile(passwordFile)).toBe(path.resolve(passwordFile));
    await assertPrivateOperatorPath(passwordFile, "file");

    if (process.platform !== "win32") {
      const linked = path.join(directory, "linked-password.txt");
      await symlink(passwordFile, linked);
      await expect(protectOperatorSecretFile(linked)).rejects.toThrow(/symbolic link/i);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "win32")("operator recovery ignores uppercase inherited PowerShell module paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bravos-recovery-module-path-"));
  const directory = path.join(root, "recovery");
  const modules = path.join(root, "modules");
  const securityModule = path.join(modules, "Microsoft.PowerShell.Security");
  try {
    await mkdir(securityModule, { recursive: true });
    await writeFile(path.join(securityModule, "Microsoft.PowerShell.Security.psd1"), String.raw`
      @{ ModuleVersion = '1.0.0'; RootModule = 'security.psm1'; FunctionsToExport = @('Get-Acl') }
    `, "utf8");
    await writeFile(path.join(securityModule, "security.psm1"), "throw 'Inherited module path must not be used for recovery ACLs.'", "utf8");
    await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", String.raw`
      import { createOperatorRecoveryOutbox } from '@bravos/identity/node';
      await createOperatorRecoveryOutbox(process.env.BRAVOS_TEST_RECOVERY_DIRECTORY).deliver({
        purpose: 'owner-recovery',
        createdAt: '2026-10-07T12:30:00.000Z',
        token: 'b'.repeat(64),
      });
    `], {
      env: { ...process.env, PSMODULEPATH: modules, BRAVOS_TEST_RECOVERY_DIRECTORY: directory },
      windowsHide: true,
      timeout: 30_000,
    });
    const latestPath = path.join(directory, "latest.json");
    expect(JSON.parse(await readFile(latestPath, "utf8"))).toEqual({
      purpose: "owner-recovery",
      createdAt: "2026-10-07T12:30:00.000Z",
      token: "b".repeat(64),
    });
    await assertPrivateOperatorPath(directory, "directory");
    await assertPrivateOperatorPath(latestPath, "file");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("operator recovery rejects a workspace ancestor without changing it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bravos-recovery-ancestor-"));
  try {
    const ancestor = path.join(root, "ancestor");
    const workspace = path.join(ancestor, "workspace");
    const marker = path.join(ancestor, "keep.txt");
    await mkdir(workspace, { recursive: true });
    await writeFile(marker, "unchanged", "utf8");
    const beforePermissions = await permissionSnapshot(ancestor);
    const before = await stat(ancestor);

    expect(() => assertOperatorRecoveryDirectory(ancestor, workspace)).toThrow(/disjoint/i);

    const after = await stat(ancestor);
    expect(await readFile(marker, "utf8")).toBe("unchanged");
    expect(await permissionSnapshot(ancestor)).toBe(beforePermissions);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function permissionSnapshot(target: string): Promise<string> {
  if (process.platform === "win32") {
    const env = { ...process.env, BRAVOS_PERMISSION_TARGET: target };
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === "psmodulepath") delete env[key];
    }
    const result = await execFileAsync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-Acl -LiteralPath $env:BRAVOS_PERMISSION_TARGET).Sddl",
    ], {
      windowsHide: true,
      encoding: "utf8",
      env,
    });
    return String(result.stdout).trim();
  }
  const info = await stat(target);
  return `${info.uid}:${info.gid}:${info.mode & 0o777}`;
}

async function assertPrivateOperatorPath(target: string, kind: "directory" | "file"): Promise<void> {
  const info = await lstat(target);
  expect(info.isSymbolicLink()).toBe(false);
  if (kind === "directory") expect(info.isDirectory()).toBe(true);
  else expect(info.isFile()).toBe(true);
  if (process.platform === "win32") {
    const env = { ...process.env, BRAVOS_PERMISSION_TARGET: target };
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === "psmodulepath") delete env[key];
    }
    const result = await execFileAsync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      String.raw`
        $ErrorActionPreference = 'Stop'
        $acl = Get-Acl -LiteralPath $env:BRAVOS_PERMISSION_TARGET
        if (-not $acl.AreAccessRulesProtected) { throw 'Recovery ACL still inherits permissions.' }
        $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $unsafe = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | Where-Object {
          $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
          $_.IdentityReference.Value -ne $sid.Value
        })
        if ($unsafe.Count -ne 0) { throw 'Recovery ACL grants another principal access.' }
        'private'
      `,
    ], {
      windowsHide: true,
      encoding: "utf8",
      env,
    });
    expect(String(result.stdout).trim()).toBe("private");
    return;
  }
  expect(info.uid).toBe(process.getuid?.());
  expect(info.mode & 0o777).toBe(kind === "directory" ? 0o700 : 0o600);
}

test("invalid recovery adapter fails before opening a database pool", async () => {
  const started = Date.now();
  await expect(
    buildApp({
      nodeEnv: "development",
      databaseUrl: "postgres://nobody:nobody@127.0.0.1:1/missing",
      authSecret: "test-secret-test-secret-test-secret-32",
      authBaseUrl: "http://127.0.0.1:3010",
      internalOrigin: INTERNAL_ORIGIN,
      publicOrigin: PUBLIC_ORIGIN,
      trustedOrigins: [INTERNAL_ORIGIN],
      secureCookies: false,
      ownerRecoveryAdapter: "unknown-adapter",
      ownerRecoveryOutboxDir: outboxDir,
    }),
  ).rejects.toThrow(/unknown owner recovery adapter/i);
  expect(Date.now() - started).toBeLessThan(2_000);
});

test("public health is reachable and public origin cannot use staff routes", async () => {
  const health = await built.app.inject({
    method: "GET",
    url: "/api/public/health",
    headers: { origin: PUBLIC_ORIGIN },
  });
  expect(health.statusCode).toBe(200);
  expect(health.json()).toMatchObject({ ok: true, application: "bravos-public" });
  const staff = await built.app.inject({
    method: "GET",
    url: "/api/internal/staff",
    headers: { origin: PUBLIC_ORIGIN },
  });
  expect(staff.statusCode).toBe(403);
});

test("provider administrative auth routes are not forwarded", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const createUser = await built.app.inject({
    method: "POST",
    url: "/api/auth/admin/create-user",
    headers: {
      origin: INTERNAL_ORIGIN,
      cookie: manager.cookie,
      "content-type": "application/json",
    },
    payload: {
      email: "bypass@example.com",
      password: "password12",
      name: "Bypass",
      role: "manager",
    },
  });
  expect(createUser.statusCode).toBe(404);
  expect(createUser.json().error.code).toBe("NOT_FOUND");
  const listUsers = await built.app.inject({
    method: "GET",
    url: "/api/auth/admin/list-users",
    headers: {
      origin: INTERNAL_ORIGIN,
      cookie: manager.cookie,
    },
  });
  expect(listUsers.statusCode).toBe(404);
  expect(listUsers.json().error.code).toBe("NOT_FOUND");
  const listed = await api(manager, "GET", "/api/internal/staff");
  expect(JSON.stringify(listed.body)).not.toContain("bypass@example.com");
  expect(JSON.stringify(listed.body)).not.toContain("Bypass");
});

test("sign-in and session responses are safe DTOs without tokens", async () => {
  const result = await signInResult("owner", "owner-pass-1");
  expect(result.status).toBe(200);
  expect(result.cookie).toMatch(/better-auth|session/i);
  assertNoSecrets(result.body);
  expect(result.body).toEqual({ ok: true });
  const session = await built.app.inject({
    method: "GET",
    url: "/api/auth/get-session",
    headers: {
      origin: INTERNAL_ORIGIN,
      cookie: result.cookie,
    },
  });
  expect(session.statusCode).toBe(200);
  const sessionBody = safeJson(session.body);
  expect(sessionBody).toEqual({ authenticated: true });
  assertNoSecrets(sessionBody);
});

test("malformed grant shapes are rejected without creating a staff account", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const before = await api(manager, "GET", "/api/internal/staff");
  const beforeCount = Array.isArray(before.body) ? before.body.length : 0;

  const stringBoolean = await api(manager, "POST", "/api/internal/staff", {
    loginName: "bad-bool",
    displayName: "خطأ منطقي",
    password: "staff-pass-7",
    grants: [{ branchId: abshwayId, cashier: "false", orderRepresentative: false }],
  });
  expect(stringBoolean.status).toBe(400);
  expect(stringBoolean.body.error.code).toBe("VALIDATION");

  const nullItem = await api(manager, "POST", "/api/internal/staff", {
    loginName: "bad-null",
    displayName: "عنصر فارغ",
    password: "staff-pass-7",
    grants: [null],
  });
  expect(nullItem.status).toBe(400);
  expect(nullItem.body.error.code).toBe("VALIDATION");

  const extraField = await api(manager, "POST", "/api/internal/staff", {
    loginName: "bad-extra",
    displayName: "حقل زائد",
    password: "staff-pass-7",
    grants: [
      {
        branchId: abshwayId,
        cashier: true,
        orderRepresentative: false,
        manageStaff: true,
      },
    ],
  });
  expect(extraField.status).toBe(400);
  expect(extraField.body.error.code).toBe("VALIDATION");

  const after = await api(manager, "GET", "/api/internal/staff");
  expect(after.body).toHaveLength(beforeCount);
  expect(JSON.stringify(after.body)).not.toContain("bad-bool");
  expect(JSON.stringify(after.body)).not.toContain("bad-null");
  expect(JSON.stringify(after.body)).not.toContain("bad-extra");
});

test("manager assigns both branches and later edits per-branch capabilities", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const me = await api(manager, "GET", "/api/internal/workspace");
  const created = await api(manager, "POST", "/api/internal/staff", {
    loginName: "two.branches",
    displayName: "موظف الفرعين",
    password: "staff-pass-8",
    grants: [
      { branchId: abshwayId, cashier: true, orderRepresentative: false },
      { branchId: fayoumId, cashier: false, orderRepresentative: true },
    ],
  });
  expect(created.status).toBe(201);
  expect(created.body.grants).toHaveLength(2);
  expect(created.body.changedByStaffId).toBe(me.body.staff.id);
  expect(created.body.changedAt).toEqual(expect.any(String));
  expect(created.body.changes).toEqual([
    expect.objectContaining({
      operation: "provision",
      actorStaffId: me.body.staff.id,
    }),
  ]);
  const employee = await signIn("two.branches", "staff-pass-8");
  const workspace = await api(employee, "GET", "/api/internal/workspace");
  expect(workspace.body.authorizedBranches.map((branch: { code: string }) => branch.code).sort()).toEqual([
    "abshway",
    "fayoum",
  ]);
  const updated = await api(manager, "POST", `/api/internal/staff/${created.body.id}/grants`, {
    grants: [{ branchId: fayoumId, cashier: true, orderRepresentative: true }],
  });
  expect(updated.status).toBe(200);
  expect(updated.body.grants).toHaveLength(1);
  expect(updated.body.grants[0].branch.code).toBe("fayoum");
  expect(updated.body.changedByStaffId).toEqual(expect.any(String));
  const afterEdit = await api(employee, "GET", "/api/internal/workspace");
  expect(afterEdit.body.authorizedBranches.map((branch: { code: string }) => branch.code)).toEqual(["fayoum"]);
});

test("active branch is isolated per session", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "tabs",
    displayName: "نوافذ",
    password: "staff-pass-10",
    grants: [
      { branchId: abshwayId, cashier: true, orderRepresentative: false },
      { branchId: fayoumId, cashier: true, orderRepresentative: false },
    ],
  });
  const first = await signIn("tabs", "staff-pass-10");
  const second = await signIn("tabs", "staff-pass-10");
  const selected = await api(first, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  expect(selected.status).toBe(200);
  expect(selected.body.activeBranch.code).toBe("abshway");
  const other = await api(second, "GET", "/api/internal/workspace");
  expect(other.status).toBe(200);
  expect(other.body.activeBranch).toBeNull();
});

test("owner recovery token is single-use under concurrent redemption", async () => {
  await api(undefined, "POST", "/api/internal/owner-recovery/request", { loginName: "owner" });
  const delivered = JSON.parse(await readFile(path.join(outboxDir, "latest.json"), "utf8")) as {
    token: string;
  };
  const [first, second] = await Promise.all([
    api(undefined, "POST", "/api/internal/owner-recovery/complete", {
      token: delivered.token,
      password: "owner-pass-3a",
    }),
    api(undefined, "POST", "/api/internal/owner-recovery/complete", {
      token: delivered.token,
      password: "owner-pass-3b",
    }),
  ]);
  const statuses = [first.status, second.status].sort();
  expect(statuses).toEqual([200, 400]);
  expect([first.body.error?.code, second.body.error?.code].filter(Boolean)).toEqual([
    "INVALID_RECOVERY",
  ]);
  const winner = first.status === 200 ? "owner-pass-3a" : "owner-pass-3b";
  const loser = winner === "owner-pass-3a" ? "owner-pass-3b" : "owner-pass-3a";
  expect((await signInResult("owner", winner)).status).toBe(200);
  const lost = await signInResult("owner", loser);
  expectAuthRejected(lost);
  const replay = await api(undefined, "POST", "/api/internal/owner-recovery/complete", {
    token: delivered.token,
    password: "owner-pass-3c",
  });
  expect(replay.status).toBe(400);
  expect(replay.body.error.code).toBe("INVALID_RECOVERY");
});

test("staff operations keep append-only manager attribution", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const me = await api(manager, "GET", "/api/internal/workspace");
  const created = await api(manager, "POST", "/api/internal/staff", {
    loginName: "attributed",
    displayName: "منسوب",
    password: "staff-pass-11",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  expect(created.status).toBe(201);
  const reset = await api(manager, "POST", `/api/internal/staff/${created.body.id}/reset-password`, {
    password: "staff-pass-11b",
  });
  expect(reset.status).toBe(200);
  const disabled = await api(manager, "POST", `/api/internal/staff/${created.body.id}/disable`);
  expect(disabled.status).toBe(200);
  const listed = await api(manager, "GET", "/api/internal/staff");
  const account = listed.body.find((item: { loginName: string }) => item.loginName === "attributed");
  expect(account.changes.map((change: { operation: string }) => change.operation)).toEqual([
    "provision",
    "reset_password",
    "disable",
  ]);
  expect(account.changes.every((change: { actorStaffId: string }) => change.actorStaffId === me.body.staff.id)).toBe(
    true,
  );
});

test("concurrent grant replacements keep one complete submitted set", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const created = await api(manager, "POST", "/api/internal/staff", {
    loginName: "race.grants",
    displayName: "سباق",
    password: "staff-pass-12",
    grants: [
      { branchId: abshwayId, cashier: true, orderRepresentative: false },
      { branchId: fayoumId, cashier: true, orderRepresentative: false },
    ],
  });
  expect(created.status).toBe(201);
  const [first, second] = await Promise.all([
    api(manager, "POST", `/api/internal/staff/${created.body.id}/grants`, {
      grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
    }),
    api(manager, "POST", `/api/internal/staff/${created.body.id}/grants`, {
      grants: [{ branchId: fayoumId, cashier: true, orderRepresentative: true }],
    }),
  ]);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  const listed = await api(manager, "GET", "/api/internal/staff");
  const account = listed.body.find((item: { loginName: string }) => item.loginName === "race.grants");
  expect(account.grants).toHaveLength(1);
  const code = account.grants[0].branch.code;
  expect(["abshway", "fayoum"]).toContain(code);
  if (code === "abshway") {
    expect(account.grants[0]).toMatchObject({ cashier: true, orderRepresentative: false });
  } else {
    expect(account.grants[0]).toMatchObject({ cashier: true, orderRepresentative: true });
  }
});

test("distinct recovery tokens serialize at the owner account", async () => {
  await api(undefined, "POST", "/api/internal/owner-recovery/request", { loginName: "owner" });
  await api(undefined, "POST", "/api/internal/owner-recovery/request", { loginName: "owner" });
  const files = await import("node:fs/promises").then((fs) => fs.readdir(outboxDir));
  const tokens: string[] = [];
  for (const file of files.filter((name) => name.startsWith("owner-recovery-"))) {
    const delivered = JSON.parse(await readFile(path.join(outboxDir, file), "utf8")) as { token: string };
    tokens.push(delivered.token);
  }
  expect(tokens.length).toBeGreaterThanOrEqual(2);
  const [first, second] = await Promise.all([
    api(undefined, "POST", "/api/internal/owner-recovery/complete", {
      token: tokens[0],
      password: "owner-pass-4a",
    }),
    api(undefined, "POST", "/api/internal/owner-recovery/complete", {
      token: tokens[1],
      password: "owner-pass-4b",
    }),
  ]);
  expect([first.status, second.status].sort()).toEqual([200, 400]);
  expect([first.body.error?.code, second.body.error?.code].filter(Boolean)).toEqual(["INVALID_RECOVERY"]);
  const winner = first.status === 200 ? "owner-pass-4a" : "owner-pass-4b";
  expect((await signInResult("owner", winner)).status).toBe(200);
  for (const token of tokens) {
    const replay = await api(undefined, "POST", "/api/internal/owner-recovery/complete", {
      token,
      password: "owner-pass-4c",
    });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe("INVALID_RECOVERY");
  }
});

test("expired recovery tokens are rejected", async () => {
  await api(undefined, "POST", "/api/internal/owner-recovery/request", { loginName: "owner" });
  const delivered = JSON.parse(await readFile(path.join(outboxDir, "latest.json"), "utf8")) as {
    token: string;
  };
  await built.pool.query(
    `UPDATE owner_recovery_challenge SET expires_at = now() - interval '1 minute' WHERE consumed_at IS NULL`,
  );
  const expired = await api(undefined, "POST", "/api/internal/owner-recovery/complete", {
    token: delivered.token,
    password: "owner-pass-5",
  });
  expect(expired.status).toBe(400);
  expect(expired.body.error.code).toBe("INVALID_RECOVERY");
  expect((await signInResult("owner", "owner-pass-1")).status).toBe(200);
});

type CookieSession = { cookie: string };

async function signIn(username: string, password: string): Promise<CookieSession> {
  const result = await signInResult(username, password);
  expect(result.status).toBe(200);
  return { cookie: result.cookie };
}

async function signInResult(username: string, password: string) {
  const response = await built.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/username",
    headers: {
      origin: INTERNAL_ORIGIN,
      "content-type": "application/json",
    },
    payload: { username, password },
  });
  return {
    status: response.statusCode,
    cookie: collectCookies(response.headers["set-cookie"]),
    body: safeJson(response.body),
  };
}

async function api(
  session: CookieSession | undefined,
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
  options?: { extraHeaders?: Record<string, string> },
) {
  const response = await built.app.inject({
    method,
    url,
    headers: {
      origin: INTERNAL_ORIGIN,
      cookie: session?.cookie ?? "",
      ...(payload ? { "content-type": "application/json" } : {}),
      ...options?.extraHeaders,
    },
    payload,
  });
  return {
    status: response.statusCode,
    body: safeJson(response.body),
  };
}

function collectCookies(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function expectAuthRejected(result: { status: number; cookie: string; body: unknown }) {
  expect(result.status).toBe(401);
  expect(result.status).toBeLessThan(500);
  expect(result.body).toEqual({
    error: { code: "UNAUTHENTICATED", messageAr: "يلزم تسجيل الدخول." },
  });
  expect(result.cookie).not.toMatch(/session_token|better-auth\.session/i);
  assertNoSecrets(result.body);
}

function assertNoSecrets(body: unknown) {
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain("token");
  expect(serialized).not.toContain(".invalid");
  expect(serialized).not.toContain("password");
  expect(serialized).not.toMatch(/"email"\s*:/);
}

function safeJson(body: string) {
  if (!body) {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

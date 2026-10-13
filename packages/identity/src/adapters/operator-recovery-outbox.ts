import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { RecoveryOutbox } from "../application/ports.ts";

const execFileAsync = promisify(execFile);

export function assertOperatorRecoveryDirectory(directory: string, workspace = resolveWorkspaceBoundary()): string {
  if (!path.isAbsolute(directory)) {
    throw new Error("BRAVOS_OWNER_RECOVERY_OUTBOX_DIR must be an absolute path for operator-file recovery.");
  }
  const root = path.parse(directory).root;
  if (path.resolve(directory) === root) {
    throw new Error("BRAVOS_OWNER_RECOVERY_OUTBOX_DIR cannot be a filesystem root.");
  }
  assertDisjoint(path.resolve(workspace), path.resolve(directory), "BRAVOS_OWNER_RECOVERY_OUTBOX_DIR");
  return path.resolve(directory);
}

export async function resolveOperatorRecoveryDirectory(directory: string): Promise<string> {
  const resolved = assertOperatorRecoveryDirectory(directory);
  return resolveExternalOperatorDirectory(resolved, "Operator recovery directory");
}

export async function prepareOperatorRecoveryDirectory(directory: string): Promise<string> {
  const protectedDirectory = assertOperatorRecoveryDirectory(directory);
  return protectDirectory(protectedDirectory);
}

export async function resolveExternalOperatorDirectory(
  directory: string,
  label: string,
  workspace = resolveWorkspaceBoundary(),
): Promise<string> {
  if (!path.isAbsolute(directory)) throw new Error(`${label} must use an absolute path.`);
  const resolved = path.resolve(directory);
  if (resolved === path.parse(resolved).root) throw new Error(`${label} cannot be a filesystem root.`);
  const workspaceRoot = path.resolve(workspace);
  assertDisjoint(workspaceRoot, resolved, label);
  const [prospectiveDirectory, realWorkspace] = await Promise.all([
    prospectiveRealPath(resolved),
    realpath(workspaceRoot),
  ]);
  assertDisjoint(realWorkspace, prospectiveDirectory, label);
  return prospectiveDirectory;
}

export async function prepareExternalOperatorDirectory(
  directory: string,
  label: string,
  workspace = resolveWorkspaceBoundary(),
): Promise<string> {
  const resolved = await resolveExternalOperatorDirectory(directory, label, workspace);
  await mkdir(resolved, { recursive: true });
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular directory, not a symbolic link or junction.`);
  }
  const [realDirectory, realWorkspace] = await Promise.all([realpath(resolved), realpath(workspace)]);
  assertDisjoint(realWorkspace, realDirectory, label);
  return realDirectory;
}

export function operatorDirectoriesOverlap(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left);
}

export function createOperatorRecoveryOutbox(directory: string): RecoveryOutbox {
  const configuredDirectory = assertOperatorRecoveryDirectory(directory);
  let preparedDirectory: string | undefined;
  return {
    kind: "operator-file",
    async deliver(message) {
      const currentDirectory = await resolveOperatorRecoveryDirectory(configuredDirectory);
      if (preparedDirectory && !samePath(currentDirectory, preparedDirectory)) {
        throw new Error("Operator recovery directory no longer resolves to its prepared location.");
      }
      const writableDirectory = await protectDirectory(configuredDirectory);
      if (!samePath(writableDirectory, currentDirectory)) {
        throw new Error("Operator recovery directory changed while preparing a recovery message.");
      }
      preparedDirectory = writableDirectory;
      const timestamp = message.createdAt.replaceAll(":", "-");
      const record = `${JSON.stringify(message)}\n`;
      const immutablePath = path.join(writableDirectory, `owner-recovery-${timestamp}-${crypto.randomUUID()}.json`);
      const latestPath = path.join(writableDirectory, "latest.json");
      await protectedWrite(immutablePath, record, false);
      await protectedWrite(latestPath, record, true);
    },
  };
}

function resolveWorkspaceBoundary(): string {
  for (const start of [process.cwd(), path.dirname(fileURLToPath(import.meta.url))]) {
    let current = path.resolve(start);
    while (true) {
      if (existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return path.resolve(process.cwd());
}

export async function protectOperatorSecretFile(file: string): Promise<string> {
  if (!path.isAbsolute(file)) throw new Error("Operator secret files must use an absolute path.");
  const resolved = path.resolve(file);
  if (resolved === path.parse(resolved).root) throw new Error("Operator secret file cannot be a filesystem root.");
  assertOutsideWorkspace(resolved, "Operator secret file");
  const info = await lstat(resolved);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("Operator secret file must be a regular file and cannot be a symbolic link.");
  }
  await assertRealPathOutsideWorkspace(resolved, "Operator secret file");
  if (process.platform === "win32") {
    await protectWindowsPath(resolved, "file");
  } else {
    assertPosixPlatform();
    await protectPosixPath(resolved, 0o600);
  }
  return resolved;
}

async function protectDirectory(directory: string): Promise<string> {
  const resolved = await resolveOperatorRecoveryDirectory(directory);
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Operator recovery directory must be a directory and cannot be a symbolic link.");
  }
  await assertRealPathOutsideWorkspace(resolved, "Operator recovery directory");
  const entries = await readdir(resolved, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    throw new Error("Operator recovery directory may contain only regular recovery files.");
  }
  if (process.platform === "win32") {
    await protectWindowsPath(resolved, "directory");
  } else {
    assertPosixPlatform();
    await protectPosixPath(resolved, 0o700);
  }
  for (const entry of entries) {
    const existing = path.join(resolved, entry.name);
    if (process.platform === "win32") {
      await protectWindowsPath(existing, "file");
    } else {
      await protectPosixPath(existing, 0o600);
    }
  }
  return realpath(resolved);
}

function assertOutsideWorkspace(target: string, label: string): void {
  const workspace = resolveWorkspaceBoundary();
  assertDisjoint(workspace, target, label);
}

async function assertRealPathOutsideWorkspace(target: string, label: string): Promise<void> {
  const [realTarget, realWorkspace] = await Promise.all([
    realpath(target),
    realpath(resolveWorkspaceBoundary()),
  ]);
  assertDisjoint(realWorkspace, realTarget, label);
}

function assertDisjoint(workspace: string, target: string, label: string): void {
  if (operatorDirectoriesOverlap(workspace, target)) {
    throw new Error(`${label} must be disjoint from the application workspace.`);
  }
}

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function samePath(left: string, right: string): boolean {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

async function prospectiveRealPath(target: string): Promise<string> {
  let current = path.resolve(target);
  const missing: string[] = [];
  while (true) {
    try {
      return path.join(await realpath(current), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

async function protectedWrite(destination: string, content: string, replace: boolean): Promise<void> {
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (process.platform === "win32") {
      await protectWindowsPath(temporary, "file");
    } else {
      assertPosixPlatform();
      await protectPosixPath(temporary, 0o600);
    }
    try {
      await rename(temporary, destination);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!replace || (code !== "EEXIST" && code !== "EPERM" && code !== "ENOTEMPTY")) throw error;
      await rm(destination, { force: true });
      await rename(temporary, destination);
    }
    if (process.platform === "win32") {
      await verifyWindowsPath(destination);
    } else {
      await verifyPosixPath(destination, 0o600);
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

function assertPosixPlatform(): void {
  if (process.platform !== "linux" && process.platform !== "darwin") {
    throw new Error(`Operator recovery cannot enforce private filesystem permissions on ${process.platform}.`);
  }
  if (typeof process.getuid !== "function") {
    throw new Error("Operator recovery cannot verify file ownership on this platform.");
  }
}

async function verifyPosixPath(target: string, expectedMode: number): Promise<void> {
  const info = await lstat(target);
  if (info.isSymbolicLink()) throw new Error("Operator recovery path cannot be a symbolic link.");
  if (info.uid !== process.getuid!()) throw new Error("Operator recovery path is not owned by this process user.");
  if ((info.mode & 0o777) !== expectedMode) {
    throw new Error("Operator recovery path permissions are not private.");
  }
}

async function protectPosixPath(target: string, expectedMode: number): Promise<void> {
  const before = await lstat(target);
  if (before.isSymbolicLink()) throw new Error("Operator recovery path cannot be a symbolic link.");
  if (before.uid !== process.getuid!()) throw new Error("Operator recovery path is not owned by this process user.");
  await chmod(target, expectedMode);
  await verifyPosixPath(target, expectedMode);
}

const WINDOWS_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:BRAVOS_OPERATOR_RECOVERY_PATH
$kind = $env:BRAVOS_OPERATOR_RECOVERY_KIND
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if (-not $sid) { throw 'Cannot determine the current Windows user SID.' }
if ($kind -eq 'directory') {
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
} elseif ($kind -eq 'file') {
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
} else { throw 'Unknown recovery path kind.' }
$acl = Get-Acl -LiteralPath $target
$acl.SetAccessRuleProtection($true, $false)
foreach ($existing in @($acl.Access)) { [void]$acl.RemoveAccessRule($existing) }
$acl.AddAccessRule($rule)
if ($kind -eq 'directory') {
  [System.IO.Directory]::SetAccessControl($target, $acl)
} else {
  [System.IO.File]::SetAccessControl($target, $acl)
}
$check = Get-Acl -LiteralPath $target
if (-not $check.AreAccessRulesProtected) { throw 'Recovery ACL still inherits permissions.' }
$rules = @($check.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
$unsafe = @($rules | Where-Object {
  $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
  $_.IdentityReference.Value -ne $sid.Value
})
if ($unsafe.Count -ne 0) { throw 'Recovery ACL grants another principal access.' }
`;

async function protectWindowsPath(target: string, kind: "directory" | "file"): Promise<void> {
  await runWindowsAcl(target, kind);
}

async function verifyWindowsPath(target: string): Promise<void> {
  const info = await lstat(target);
  if (info.isSymbolicLink()) throw new Error("Operator recovery path cannot be a symbolic link.");
  await runWindowsAcl(target, info.isDirectory() ? "directory" : "file");
}

async function runWindowsAcl(target: string, kind: "directory" | "file"): Promise<void> {
  try {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === "psmodulepath") delete env[key];
    }
    env.BRAVOS_OPERATOR_RECOVERY_PATH = target;
    env.BRAVOS_OPERATOR_RECOVERY_KIND = kind;
    await execFileAsync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      WINDOWS_ACL_SCRIPT,
    ], {
      windowsHide: true,
      env,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Operator recovery could not enforce and verify a private Windows ACL: ${detail}`);
  }
}

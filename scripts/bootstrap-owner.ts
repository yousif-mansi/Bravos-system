import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { protectOperatorSecretFile } from "@bravos/identity/node";
import { buildApp } from "../apps/api/src/app.ts";
import { ensureOwner } from "../apps/api/src/bootstrap.ts";
import { loadConfig } from "../apps/api/src/config.ts";

const { values } = parseArgs({
  options: {
    login: { type: "string" },
    "display-name": { type: "string" },
    "password-file": { type: "string" },
  },
  strict: true,
});
const loginName = values.login;
const displayName = values["display-name"];
const passwordPath = values["password-file"];
if (!loginName || !displayName || !passwordPath) {
  throw new Error(
    "Usage: pnpm release:bootstrap-owner --login <name> --display-name <Arabic name> --password-file <absolute path>",
  );
}

const passwordFile = await protectOperatorSecretFile(passwordPath);
const password = (await readFile(passwordFile, "utf8")).replace(/[\r\n]+$/, "");
if (!password) throw new Error("The owner password file is empty.");
if (/[\r\n]/.test(password)) throw new Error("The owner password file must contain exactly one line.");

const built = await buildApp(loadConfig());
try {
  const existing = await built.pool.query<{ username: string }>(
    `SELECT u.username
       FROM staff_profile p
       JOIN "user" u ON u.id = p.staff_id
      WHERE p.is_owner
      LIMIT 1`,
  );
  const existingLogin = existing.rows[0]?.username;
  if (existingLogin) {
    throw new Error(`An owner already exists as "${existingLogin}". Refusing to create or change an account.`);
  }
  const owner = await ensureOwner(built.services, {
    loginName,
    displayName,
    password,
  });
  console.log(`Created the single owner account "${owner.loginName}".`);
} finally {
  await built.close();
}

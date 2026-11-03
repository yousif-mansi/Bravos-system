import assert from "node:assert/strict";
import test from "node:test";
import { defaultHelperPath, dpapiStdin, planOwnedHelperSpawn, runOwnedHelper } from "../../apps/print-connector/src/adapters/owned-helper.ts";

const helperPath = defaultHelperPath();

test("the real DPAPI helper round-trips fixture bytes when its path contains spaces", { skip: process.platform !== "win32" }, async () => {
  assert.equal(helperPath.includes(" "), true);
  const systemRoot = process.env.SystemRoot ?? "";
  const plan = planOwnedHelperSpawn({ systemRoot, helperPath });
  assert.equal(plan.shell, false);
  assert.equal(plan.windowsHide, true);
  assert.equal(plan.args.includes("-Command"), false);
  assert.equal(plan.args.at(-1), helperPath);
  const fixture = Buffer.from("fixture-bytes-not-a-token", "utf8");
  const protect = await runOwnedHelper({ plan, stdin: dpapiStdin("protect", fixture) });
  assert.equal(protect.code, 0);
  const cipher = Buffer.from(protect.stdout.toString("utf8").trim(), "base64");
  assert.equal(cipher.equals(fixture), false);
  const round = await runOwnedHelper({ plan, stdin: dpapiStdin("unprotect", cipher) });
  assert.equal(round.code, 0);
  const plain = Buffer.from(round.stdout.toString("utf8").trim(), "base64");
  assert.equal(plain.equals(fixture), true);
  const argv = plan.args.join("\n");
  assert.equal(argv.includes("fixture-bytes-not-a-token"), false);
  assert.equal(argv.includes("payloadBase64"), false);
});

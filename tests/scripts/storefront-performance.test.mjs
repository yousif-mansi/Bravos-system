import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { calculateCls } from "../../scripts/measure-storefront-performance.mjs";

const cli = fileURLToPath(new URL("../../scripts/measure-storefront-performance.mjs", import.meta.url));
const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 10_000 });

const shift = (time, value, hadRecentInput = false) => ({ time, value, hadRecentInput });

test("CLS uses the largest session window rather than a lifetime sum", () => {
  assert.equal(calculateCls([]), 0);
  assert.equal(calculateCls([shift(0, 0.125), shift(900, 0.125), shift(2000, 0.125)]), 0.25);
});

test("CLS excludes recent-input shifts without extending a session", () => {
  assert.equal(calculateCls([shift(0, 0.125), shift(900, 1, true), shift(1100, 0.25)]), 0.25);
});

test("CLS starts a new session at exactly a one-second gap", () => {
  assert.equal(calculateCls([shift(0, 0.125), shift(1000, 0.25)]), 0.25);
  assert.equal(calculateCls([shift(0, 0.125), shift(999, 0.25)]), 0.375);
});

test("CLS starts a new session at exactly five seconds despite short gaps", () => {
  const entries = [0, 900, 1800, 2700, 3600, 4500].map((time) => shift(time, 0.125));
  assert.equal(calculateCls([...entries, shift(4999, 0.125)]), 0.875);
  assert.equal(calculateCls([...entries, shift(5000, 0.125)]), 0.75);
});

test("CLI help exits without requiring a browser or prepared cart", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /24 successful cold samples/);
  assert.equal(result.stderr, "");
});

test("CLI missing arguments fail before browser startup or report creation", () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Required: --origin/);
  assert.equal(result.stdout, "");
});

test("CLI rejects a remote origin before opening even a nonexistent cart file", () => {
  const result = run(["--origin", "https://example.com", "--product-id", "fixture",
    "--cart-state", "this-file-does-not-exist.json", "--build-label", "fixture",
    "--photo-provenance", "synthetic", "--photo-kind", "synthetic",
    "--fixture-label", "fixture", "--hero-note", "none", "--attest-isolated-production"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be a localhost\/127\.0\.0\.1/);
  assert.doesNotMatch(result.stderr, /ENOENT|browser/);
  assert.equal(result.stdout, "");
});

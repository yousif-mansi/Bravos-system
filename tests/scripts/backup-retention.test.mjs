import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pruner = fileURLToPath(new URL("../../deploy/scripts/prune-backups.sh", import.meta.url));
const skip = process.platform === "win32" ? "the VPS deploy scripts run on Linux" : false;

function stampDaysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

async function backupDir(sets, extra = []) {
  const dir = await mkdtemp(path.join(tmpdir(), "bravos-backup-retention-"));
  for (const [index, days] of sets.entries()) {
    const prefix = `bravos-${stampDaysAgo(days)}-${1000 + index}`;
    for (const suffix of [".dump", "-media.tar.gz", ".sha256"]) await writeFile(path.join(dir, prefix + suffix), "x");
  }
  for (const name of extra) await writeFile(path.join(dir, name), "x");
  return dir;
}

function prune(dir, ...args) {
  return spawnSync("bash", [pruner, dir, ...args], { encoding: "utf8" });
}

async function ages(dir) {
  return (await readdir(dir)).sort();
}

test("removes whole backup sets older than the window and keeps newer ones", { skip }, async () => {
  const dir = await backupDir([45, 31, 29, 1]);
  try {
    const kept = (await ages(dir)).filter((name) => /-100[23]/.test(name));
    const result = prune(dir, "30");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await ages(dir), kept);
    assert.match(result.stdout, /Removed 6 backup files older than 30 days/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("defaults to 30 days", { skip }, async () => {
  const dir = await backupDir([31, 29]);
  try {
    assert.equal(prune(dir).status, 0);
    assert.equal((await ages(dir)).length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("always keeps the newest set, however old", { skip }, async () => {
  const dir = await backupDir([90, 60]);
  try {
    assert.equal(prune(dir, "30").status, 0);
    assert.deepEqual((await ages(dir)).map((name) => name.split("-")[2].slice(0, 4)), ["1001", "1001", "1001"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("never touches files that are not backup sets", { skip }, async () => {
  const others = ["notes.txt", "bravos-old.dump", "bravos-20200101T000000Z-1.dump.part", "other-20200101T000000Z-1.dump"];
  const dir = await backupDir([1], others);
  try {
    assert.equal(prune(dir, "30").status, 0);
    for (const name of others) assert.ok((await ages(dir)).includes(name), name);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a retention that is not a whole number of days and deletes nothing", { skip }, async () => {
  const dir = await backupDir([45, 1]);
  try {
    for (const days of ["0", "-5", "abc", "7.5", ""]) {
      const result = prune(dir, days);
      assert.notEqual(result.status, 0, days);
      assert.match(result.stderr, /whole number of days/);
    }
    assert.equal((await ages(dir)).length, 6);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a missing backup directory", { skip }, async () => {
  const result = prune(path.join(tmpdir(), "bravos-no-such-backup-dir"), "30");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No backup directory/);
});

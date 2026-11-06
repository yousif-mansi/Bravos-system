import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const excelRequire = createRequire(require.resolve("@ayocore/exceljs"));
const ExcelJS = excelRequire("@ayocore/exceljs");
const archiver = excelRequire("archiver");
const archiverRequire = createRequire(excelRequire.resolve("archiver"));
const utils = archiverRequire("archiver-utils");
const JSZip = excelRequire("jszip");

async function collectArchive(configure) {
  const archive = archiver("zip");
  const chunks = [];
  archive.on("data", chunk => chunks.push(chunk));
  const complete = finished(archive);
  configure(archive);
  await archive.finalize();
  await complete;
  return JSZip.loadAsync(Buffer.concat(chunks));
}

async function files(zip) {
  return Object.values(zip.files).filter(entry => !entry.dir).map(entry => entry.name).sort();
}

test("archive directory, glob and expand preserve nested and hidden files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bravos-archive-compat-"));
  try {
    await mkdir(path.join(root, "nested", "skip"), { recursive: true });
    await writeFile(path.join(root, "one.txt"), "one");
    await writeFile(path.join(root, ".hidden.txt"), "hidden");
    await writeFile(path.join(root, "nested", "two.txt"), "two");
    await writeFile(path.join(root, "nested", "skip", "three.txt"), "three");
    await writeFile(path.join(root, "nested", "other.md"), "other");

    const directoryZip = await collectArchive(archive => archive.directory(root, "tree"));
    assert.deepEqual(await files(directoryZip), ["tree/.hidden.txt", "tree/nested/other.md", "tree/nested/skip/three.txt", "tree/nested/two.txt", "tree/one.txt"]);
    assert.equal(await directoryZip.file("tree/nested/two.txt").async("string"), "two");

    const globZip = await collectArchive(archive => archive.glob("**/*.txt", { cwd: root, dot: true, ignore: ["nested/skip/**"] }));
    assert.deepEqual(await files(globZip), [".hidden.txt", "nested/two.txt", "one.txt"]);
    assert.equal(await globZip.file(".hidden.txt").async("string"), "hidden");

    // Both glob 10 and 14 return native separators on Windows; ZIP names stay portable.
    assert.deepEqual(utils.file.expand({ cwd: root, dot: true, ignore: ["nested/skip/**"] }, "**/*.txt").sort(), [".hidden.txt", path.join("nested", "two.txt"), "one.txt"]);
  } finally {
    const resolvedRoot = path.resolve(root);
    assert.equal(path.dirname(resolvedRoot), path.resolve(tmpdir()));
    assert.ok(path.basename(resolvedRoot).startsWith("bravos-archive-compat-"));
    await rm(resolvedRoot, { recursive: true, force: true });
  }
});

test("ExcelJS streaming workbook creates a readable archive with worksheet values", async () => {
  const output = new PassThrough();
  const chunks = [];
  output.on("data", chunk => chunks.push(chunk));
  const complete = finished(output);
  const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useSharedStrings: true });
  const sheet = writer.addWorksheet("Sales");
  sheet.addRow(["Product", "Amount"]).commit();
  sheet.addRow(["قميص", 175]).commit();
  sheet.commit();
  await writer.commit();
  await complete;

  const bytes = Buffer.concat(chunks);
  const zip = await JSZip.loadAsync(bytes);
  assert.ok(zip.file("xl/workbook.xml"));
  assert.ok(zip.file("xl/worksheets/sheet1.xml"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.deepEqual(workbook.getWorksheet("Sales").getRow(2).values.slice(1), ["قميص", 175]);
});

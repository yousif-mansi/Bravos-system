import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  operatorDirectoriesOverlap,
  prepareExternalOperatorDirectory,
} from "@bravos/identity/node";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

test("external release directories reject a parent junction that resolves into the workspace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bravos-release-paths-"));
  cleanup.push(root);
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside");
  const internalMedia = path.join(workspace, "media");
  await Promise.all([mkdir(internalMedia, { recursive: true }), mkdir(outside, { recursive: true })]);
  const bridge = path.join(outside, "workspace-bridge");
  await symlink(workspace, bridge, process.platform === "win32" ? "junction" : "dir");

  await expect(
    prepareExternalOperatorDirectory(path.join(bridge, "media"), "Product media directory", workspace),
  ).rejects.toThrow(/disjoint/i);
});

test("release recovery and media directories cannot overlap", () => {
  expect(operatorDirectoriesOverlap("C:/BravosPrivate/recovery", "C:/BravosPrivate/recovery/media")).toBe(true);
  expect(operatorDirectoriesOverlap("C:/BravosPrivate/recovery", "C:/BravosPrivate/media")).toBe(false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { launcherName, validateName } from "../src/paths.js";

test("valid profile names pass", () => {
  for (const name of ["ca", "work", "client-x", "acc_2", "A1"]) {
    assert.equal(validateName(name), null, name);
  }
});

test("invalid profile names are rejected", () => {
  for (const name of [undefined, "", "-ca", "ca space", "ca/../..", "ca.exe", "a".repeat(33)]) {
    assert.ok(validateName(name), String(name));
  }
});

test("launcher naming", () => {
  assert.equal(launcherName("ca"), "claude-ca");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { keychainService, launcherName, validateName } from "../src/paths.js";

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

test("macOS keychain service name is derived from the profile dir", () => {
  // sha256("/Users/alice/.ccm/profiles/work") starts with ae1f0aa5.
  assert.equal(keychainService("/Users/alice/.ccm/profiles/work"), "Claude Code-credentials-ae1f0aa5");
  assert.notEqual(keychainService("/a"), keychainService("/b"));
});

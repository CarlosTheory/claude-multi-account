import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { IS_WIN, hasSh, makeSandbox, runCcm, runShim, seedDefaultInstall } from "./helpers.js";

// Each describe block gets its own sandbox HOME so tests can't interfere.
describe("basic commands", () => {
  const sb = makeSandbox();
  after(() => sb.cleanup());

  test("help exits 0 and shows usage", () => {
    const r = runCcm(sb, ["help"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /ccm add <name>/);
  });

  test("no args shows help", () => {
    assert.equal(runCcm(sb, []).code, 0);
  });

  test("unknown command exits 1", () => {
    const r = runCcm(sb, ["frobnicate"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Unknown command/);
  });

  test("list with no profiles", () => {
    const r = runCcm(sb, ["list"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /No profiles yet/);
  });

  test("doctor exits 0 and reports the (fake) claude binary", () => {
    const r = runCcm(sb, ["doctor"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /claude binary: {3}OK/);
    assert.match(r.stdout, /profiles never self-update/);
  });
});

describe("ccm add — isolated profiles", () => {
  const sb = makeSandbox();
  after(() => sb.cleanup());

  test("creates profile dir and launcher shims", () => {
    const r = runCcm(sb, ["add", "work"]);
    assert.equal(r.code, 0);
    assert.ok(fs.existsSync(path.join(sb.profilesDir, "work")), "profile dir exists");
    const base = path.join(sb.binDir, "claude-work");
    assert.ok(fs.existsSync(base), "sh shim exists");
    if (IS_WIN) {
      assert.ok(fs.existsSync(`${base}.cmd`), "cmd shim exists");
      assert.ok(fs.existsSync(`${base}.ps1`), "ps1 shim exists");
    }
  });

  test("shims point at the profile and disable the auto-updater", () => {
    const base = path.join(sb.binDir, "claude-work");
    const sh = fs.readFileSync(base, "utf8");
    assert.match(sh, /CLAUDE_CONFIG_DIR=".*\/\.ccm\/profiles\/work"/);
    assert.match(sh, /export DISABLE_AUTOUPDATER=1/);
    assert.match(sh, /\.ccm-oauth-token/);
    assert.match(sh, /exec claude "\$@"/);
    if (IS_WIN) {
      const cmd = fs.readFileSync(`${base}.cmd`, "utf8");
      assert.match(cmd, /set "CLAUDE_CONFIG_DIR=.*\\\.ccm\\profiles\\work"/);
      assert.match(cmd, /set "DISABLE_AUTOUPDATER=1"/);
      const ps1 = fs.readFileSync(`${base}.ps1`, "utf8");
      assert.match(ps1, /\$env:CLAUDE_CONFIG_DIR = ".*\\\.ccm\\profiles\\work"/);
      assert.match(ps1, /\$env:DISABLE_AUTOUPDATER = "1"/);
    }
  });

  test("unix shim is executable", { skip: IS_WIN }, () => {
    const mode = fs.statSync(path.join(sb.binDir, "claude-work")).mode & 0o777;
    assert.equal(mode & 0o111, 0o111, "shim has exec bits");
  });

  test("re-adding an existing profile regenerates the launcher", () => {
    fs.rmSync(path.join(sb.binDir, "claude-work"));
    const r = runCcm(sb, ["add", "work"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /already existed/);
    assert.ok(fs.existsSync(path.join(sb.binDir, "claude-work")), "launcher regenerated");
  });

  test("invalid names are rejected", () => {
    for (const bad of ["../evil", "has space", "-lead", "x".repeat(40)]) {
      const r = runCcm(sb, ["add", bad]);
      assert.equal(r.code, 1, bad);
      assert.match(r.stderr, /Invalid profile name|required/);
    }
  });

  test("list shows the profile as not logged in", () => {
    const r = runCcm(sb, ["list"]);
    assert.match(r.stdout, /work\s+claude-work\s+\[not logged in\]/);
  });

  test("list shows logged in when credentials exist", () => {
    fs.writeFileSync(path.join(sb.profilesDir, "work", ".credentials.json"), "{}");
    const r = runCcm(sb, ["list"]);
    assert.match(r.stdout, /work\s+claude-work\s+\[logged in\]/);
  });
});

describe("ccm add — linked and copied profiles", () => {
  const sb = makeSandbox();
  after(() => sb.cleanup());
  before(() => seedDefaultInstall(sb));

  test("--link-default creates marker and a pass-through launcher", () => {
    const r = runCcm(sb, ["add", "main", "--link-default"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /LINKED profile/);
    assert.ok(fs.existsSync(path.join(sb.profilesDir, "main", ".ccm-linked-default")), "marker exists");
    const sh = fs.readFileSync(path.join(sb.binDir, "claude-main"), "utf8");
    assert.doesNotMatch(sh, /CLAUDE_CONFIG_DIR/, "linked shim must not set CLAUDE_CONFIG_DIR");
    assert.doesNotMatch(sh, /DISABLE_AUTOUPDATER/, "linked shim must not disable updates");
    if (IS_WIN) {
      const cmd = fs.readFileSync(path.join(sb.binDir, "claude-main.cmd"), "utf8");
      assert.doesNotMatch(cmd, /CLAUDE_CONFIG_DIR|DISABLE_AUTOUPDATER/);
    }
  });

  test("list shows linked profile", () => {
    const r = runCcm(sb, ["list"]);
    assert.match(r.stdout, /main\s+claude-main\s+\[linked to default\]/);
  });

  test("--link-default with --copy-default is rejected", () => {
    const r = runCcm(sb, ["add", "x", "--link-default", "--copy-default"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /mutually exclusive/);
  });

  test("changing an existing profile's kind is rejected", () => {
    runCcm(sb, ["add", "plain"]);
    const r = runCcm(sb, ["add", "plain", "--link-default"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /already exists as a normal profile/);
    const r2 = runCcm(sb, ["add", "main"]);
    assert.equal(r2.code, 1);
    assert.match(r2.stderr, /already exists as a linked profile/);
  });

  test("--copy-default seeds the profile from the default installation", () => {
    const r = runCcm(sb, ["add", "ca", "--copy-default"]);
    assert.equal(r.code, 0);
    const dir = path.join(sb.profilesDir, "ca");
    assert.ok(fs.existsSync(path.join(dir, "settings.json")), "settings copied");
    assert.ok(fs.existsSync(path.join(dir, ".credentials.json")), "credentials copied");
    assert.ok(fs.existsSync(path.join(dir, "plugins", "plugin.txt")), "plugins copied");
    assert.ok(fs.existsSync(path.join(dir, "projects", "proj-a", "history.jsonl")), "history copied");
    assert.ok(fs.existsSync(path.join(dir, ".claude.json")), ".claude.json copied INTO the profile");
    assert.ok(!fs.existsSync(path.join(dir, "shell-snapshots")), "ephemeral dirs skipped");
    assert.ok(!fs.existsSync(path.join(dir, "telemetry")), "ephemeral dirs skipped");
    assert.match(runCcm(sb, ["list"]).stdout, /ca\s+claude-ca\s+\[logged in\]/);
  });

  test("copied profile is independent — editing it leaves the original untouched", () => {
    fs.writeFileSync(path.join(sb.profilesDir, "ca", "settings.json"), `{"theme":"light"}\n`);
    assert.equal(fs.readFileSync(path.join(sb.defaultClaudeDir, "settings.json"), "utf8"), `{"theme":"dark"}\n`);
  });

  test("--copy-default refuses to overwrite an existing profile", () => {
    const r = runCcm(sb, ["add", "ca", "--copy-default"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /refusing to overwrite/);
  });

  test("--copy-default without a default installation fails cleanly", () => {
    const empty = makeSandbox();
    try {
      const r = runCcm(empty, ["add", "ca", "--copy-default"]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /No default Claude installation found/);
    } finally {
      empty.cleanup();
    }
  });
});

describe("ccm remove", () => {
  const sb = makeSandbox();
  after(() => sb.cleanup());
  before(() => seedDefaultInstall(sb));

  test("remove keeps data, deletes launcher", () => {
    runCcm(sb, ["add", "work"]);
    const r = runCcm(sb, ["remove", "work"]);
    assert.equal(r.code, 0);
    assert.ok(fs.existsSync(path.join(sb.profilesDir, "work")), "data kept");
    assert.ok(!fs.existsSync(path.join(sb.binDir, "claude-work")), "launcher gone");
    if (IS_WIN) {
      assert.ok(!fs.existsSync(path.join(sb.binDir, "claude-work.cmd")));
      assert.ok(!fs.existsSync(path.join(sb.binDir, "claude-work.ps1")));
    }
  });

  test("remove --purge deletes data too", () => {
    const r = runCcm(sb, ["remove", "work", "--purge"]);
    assert.equal(r.code, 0);
    assert.ok(!fs.existsSync(path.join(sb.profilesDir, "work")), "data deleted");
  });

  test("purging a LINKED profile never touches the real default installation", () => {
    runCcm(sb, ["add", "main", "--link-default"]);
    const r = runCcm(sb, ["remove", "main", "--purge"]);
    assert.equal(r.code, 0);
    assert.ok(fs.existsSync(sb.defaultClaudeDir), "~/.claude survives");
    assert.ok(fs.existsSync(path.join(sb.defaultClaudeDir, "settings.json")), "default contents survive");
    assert.ok(fs.existsSync(sb.defaultClaudeJson), "~/.claude.json survives");
  });

  test("removing a nonexistent profile fails", () => {
    const r = runCcm(sb, ["remove", "ghost"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /does not exist/);
  });
});

describe("ccm token", () => {
  const sb = makeSandbox();
  after(() => sb.cleanup());

  test("stores a trimmed token from stdin", () => {
    runCcm(sb, ["add", "mac"]);
    const r = runCcm(sb, ["token", "mac"], { input: "  sk-fake-token-123  \n" });
    assert.equal(r.code, 0);
    const tokenFile = path.join(sb.profilesDir, "mac", ".ccm-oauth-token");
    assert.equal(fs.readFileSync(tokenFile, "utf8"), "sk-fake-token-123\n");
    if (!IS_WIN) {
      assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600, "token file is 0600");
    }
    assert.match(runCcm(sb, ["list"]).stdout, /mac\s+claude-mac\s+\[token\]/);
  });

  test("token --clear removes it", () => {
    const r = runCcm(sb, ["token", "mac", "--clear"]);
    assert.equal(r.code, 0);
    assert.ok(!fs.existsSync(path.join(sb.profilesDir, "mac", ".ccm-oauth-token")));
  });

  test("empty token is rejected", () => {
    const r = runCcm(sb, ["token", "mac"], { input: "\n" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /No token provided/);
  });

  test("token on a linked profile is rejected", () => {
    runCcm(sb, ["add", "main", "--link-default"]);
    const r = runCcm(sb, ["token", "main"], { input: "tok\n" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /linked to the default/);
  });
});

describe("ccm run — env passed to claude", () => {
  const sb = makeSandbox();
  after(() => sb.cleanup());
  before(() => seedDefaultInstall(sb));

  test("isolated profile: CLAUDE_CONFIG_DIR set, auto-updater disabled, args pass through", () => {
    runCcm(sb, ["add", "work"]);
    const r = runCcm(sb, ["run", "work", "--resume", "abc"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /FAKE_CLAUDE/);
    assert.match(r.stdout, new RegExp(`CONFIG=.*[\\\\/]\\.ccm[\\\\/]profiles[\\\\/]work`));
    assert.match(r.stdout, /AUTOUPD=1/);
    assert.match(r.stdout, /ARGS=--resume abc/);
  });

  test("isolated profile with token exports CLAUDE_CODE_OAUTH_TOKEN", () => {
    runCcm(sb, ["token", "work"], { input: "sk-fake-999\n" });
    const r = runCcm(sb, ["run", "work"]);
    assert.match(r.stdout, /TOKEN=sk-fake-999/);
  });

  test("linked profile: environment left untouched", () => {
    runCcm(sb, ["add", "main", "--link-default"]);
    const r = runCcm(sb, ["run", "main"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /CONFIG= /, "no CLAUDE_CONFIG_DIR leaks to a linked run");
    assert.match(r.stdout, /AUTOUPD= /, "auto-updater not disabled for the default installation");
  });

  test("claude's exit code propagates", () => {
    const r = runCcm(sb, ["run", "work"], { env: { FAKE_CLAUDE_EXIT: "7" } });
    assert.equal(r.code, 7);
  });

  test("running a nonexistent profile fails", () => {
    const r = runCcm(sb, ["run", "ghost"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /does not exist/);
  });
});

describe("ccm where", () => {
  const sb = makeSandbox();
  after(() => sb.cleanup());
  before(() => seedDefaultInstall(sb));

  test("prints the exact profile data dir, bare path on stdout", () => {
    runCcm(sb, ["add", "work"]);
    const r = runCcm(sb, ["where", "work"]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), path.join(sb.profilesDir, "work"));
  });

  test("linked profile points at the default installation", () => {
    runCcm(sb, ["add", "main", "--link-default"]);
    const r = runCcm(sb, ["where", "main"]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), sb.defaultClaudeDir);
  });

  test("`path` works as an alias", () => {
    const r = runCcm(sb, ["path", "work"]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), path.join(sb.profilesDir, "work"));
  });

  test("nonexistent profile fails", () => {
    const r = runCcm(sb, ["where", "ghost"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /does not exist/);
  });

  test("missing name fails with usage hint", () => {
    const r = runCcm(sb, ["where"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Usage: ccm where/);
  });
});

describe("ccm update", () => {
  const sb = makeSandbox();
  after(() => sb.cleanup());

  test("runs `claude update` against the shared binary, outside any profile", () => {
    const r = runCcm(sb, ["update"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /ARGS=update/);
    assert.match(r.stdout, /CONFIG= /, "update must not run inside a profile config");
    assert.match(r.stdout, /AUTOUPD= /, "manual update path must not be blocked");
  });
});

describe("generated launchers executed for real", () => {
  const sb = makeSandbox();
  after(() => sb.cleanup());

  before(() => {
    runCcm(sb, ["add", "work"]);
    runCcm(sb, ["token", "work"], { input: "sk-shim-token\n" });
    runCcm(sb, ["add", "main", "--link-default"]);
  });

  test("cmd shim (Windows cmd.exe)", { skip: !IS_WIN }, () => {
    const r = runShim(sb, path.join(sb.binDir, "claude-work"), "cmd", ["--version"]);
    assert.equal(r.code, 0);
    assert.match(r.out, /CONFIG=.*\\\.ccm\\profiles\\work/);
    assert.match(r.out, /AUTOUPD=1/);
    assert.match(r.out, /TOKEN=sk-shim-token/);
    assert.match(r.out, /ARGS=--version/);
  });

  test("ps1 shim (PowerShell)", { skip: !IS_WIN }, () => {
    const r = runShim(sb, path.join(sb.binDir, "claude-work"), "ps1", ["--version"]);
    assert.equal(r.code, 0);
    assert.match(r.out, /CONFIG=.*\\\.ccm\\profiles\\work/);
    assert.match(r.out, /AUTOUPD=1/);
    assert.match(r.out, /TOKEN=sk-shim-token/);
  });

  test("sh shim (sh / Git Bash)", { skip: !hasSh() }, () => {
    const r = runShim(sb, path.join(sb.binDir, "claude-work"), "sh", ["--version"]);
    assert.equal(r.code, 0);
    assert.match(r.out, /CONFIG=.*[\\/]\.ccm[\\/]profiles[\\/]work/);
    assert.match(r.out, /AUTOUPD=1/);
    assert.match(r.out, /TOKEN=sk-shim-token/);
  });

  test("linked cmd shim leaves env untouched", { skip: !IS_WIN }, () => {
    const r = runShim(sb, path.join(sb.binDir, "claude-main"), "cmd", ["--version"]);
    assert.equal(r.code, 0);
    assert.match(r.out, /CONFIG= /);
    assert.match(r.out, /AUTOUPD= /);
  });

  test("linked sh shim leaves env untouched", { skip: !hasSh() }, () => {
    const r = runShim(sb, path.join(sb.binDir, "claude-main"), "sh", ["--version"]);
    assert.equal(r.code, 0);
    assert.match(r.out, /CONFIG= /);
    assert.match(r.out, /AUTOUPD= /);
  });

  test("shim exit code propagation (cmd)", { skip: !IS_WIN }, () => {
    const r = runShim(sb, path.join(sb.binDir, "claude-work"), "cmd", [], { FAKE_CLAUDE_EXIT: "9" });
    assert.equal(r.code, 9);
  });

  test("shim exit code propagation (sh)", { skip: !hasSh() }, () => {
    const r = runShim(sb, path.join(sb.binDir, "claude-work"), "sh", [], { FAKE_CLAUDE_EXIT: "9" });
    assert.equal(r.code, 9);
  });
});

#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { BIN_DIR, PROFILES_DIR, launcherName } from "../src/paths.js";
import { runClaude } from "../src/claude-bin.js";
import { binDirOnPath, setupPath } from "../src/pathenv.js";
import {
  addProfile,
  listProfiles,
  profileExists,
  removeProfile,
  runProfile,
  setToken,
} from "../src/profiles.js";

const VERSION = "0.1.0";

const HELP = `ccm ${VERSION} — Claude Code Multi: isolated Claude Code profiles per account

Usage:
  ccm add <name>            Create profile <name> and its claude-<name> launcher
  ccm add <name> --link-default   Launcher uses your ORIGINAL claude as-is (same
                                  account/data; "claude" keeps working unchanged)
  ccm add <name> --copy-default   Seed the new profile with a full copy of your
                                  original installation, then it's independent
  ccm list                  List profiles and their login state
  ccm remove <name>         Remove the launcher (keeps profile data)
  ccm remove <name> --purge Remove launcher AND delete all profile data
  ccm run <name> [args...]  Run claude with a profile without using the launcher
  ccm token <name>          Store a long-lived OAuth token for <name> (macOS multi-account)
  ccm token <name> --clear  Remove the stored token
  ccm update                Update the shared claude binary (all profiles get it)
  ccm setup-path            Add ~/.ccm/bin to your PATH permanently
  ccm doctor                Check installation, PATH and profiles
  ccm help                  Show this help

Example:
  ccm add ca          →  then run: claude-ca   (log in with your personal account)
  ccm add work        →  then run: claude-work (log in with your work account)

Each profile keeps its own login, settings, plugins, MCP servers and history in
~/.ccm/profiles/<name>. On macOS, logins share the system Keychain — use
"claude setup-token" + "ccm token <name>" there to keep accounts separate.`;

function ok(msg) {
  console.log(msg);
}

function fail(msg) {
  console.error(`ccm: ${msg}`);
  process.exit(1);
}

function pathHint() {
  if (binDirOnPath()) return "";
  return `\nNote: ${BIN_DIR} is not on your PATH yet. Run "ccm setup-path" once, then open a new terminal.`;
}

function cmdAdd(name, { linkDefault, copyDefault }) {
  if (profileExists(name)) {
    addProfile(name, { linkDefault, copyDefault }); // regenerate launcher (errors if kind changes)
    ok(`Profile "${name}" already existed — launcher regenerated.${pathHint()}`);
    return;
  }
  if (copyDefault) {
    ok(`Copying your default Claude installation (plugins + history included — this can take a minute)...`);
  }
  const { dir, launcher } = addProfile(name, { linkDefault, copyDefault });
  if (linkDefault) {
    ok(`Created LINKED profile "${name}"
  launcher: ${launcher} → runs your original claude unchanged (same account, settings, plugins, history)

Running "claude" directly keeps working exactly as before.${pathHint()}`);
  } else if (copyDefault) {
    ok(`Created profile "${name}" seeded from your default installation
  data:     ${dir}
  launcher: ${launcher}

It starts with your current account, settings, plugins and history, but from now
on it's fully independent — changes here never touch the original.${pathHint()}`);
  } else {
    ok(`Created profile "${name}"
  data:     ${dir}
  launcher: ${launcher}

Next: run "${launcher}" and log in with the account you want tied to this profile.${pathHint()}`);
  }
}

function cmdList() {
  const profiles = listProfiles();
  if (profiles.length === 0) {
    ok(`No profiles yet. Create one with: ccm add <name>`);
    return;
  }
  ok(`Profiles in ${PROFILES_DIR}:\n`);
  for (const p of profiles) {
    const auth = p.linked ? "linked to default" : p.hasToken ? "token" : p.loggedIn ? "logged in" : "not logged in";
    ok(`  ${p.name.padEnd(16)} ${p.launcher.padEnd(24)} [${auth}]`);
  }
  ok(pathHint().trim() ? pathHint() : "");
}

function cmdRemove(name, purge) {
  if (purge) {
    // Deleting login + history + plugins for the profile — confirm via explicit flag only.
    const { dir } = removeProfile(name, { purge: true });
    ok(`Removed profile "${name}" and deleted all its data (${dir}).`);
  } else {
    removeProfile(name, { purge: false });
    ok(`Removed launcher "${launcherName(name)}". Profile data kept — delete it with: ccm remove ${name} --purge`);
  }
}

async function cmdToken(name, clear) {
  if (clear) {
    setToken(name, null);
    ok(`Token cleared for "${name}".`);
    return;
  }
  ok(`Paste the token from "claude setup-token" (input is not hidden):`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const token = (await rl.question("> ")).trim();
  rl.close();
  if (!token) fail("No token provided.");
  setToken(name, token);
  ok(`Token stored for "${name}". The ${launcherName(name)} launcher will use it automatically.`);
}

function cmdUpdate() {
  // One shared binary: updating here updates every profile at once. Profile
  // launchers run with DISABLE_AUTOUPDATER=1, so this (or the original
  // installation's own auto-update) is where updates happen.
  ok("Updating the shared claude binary — all profiles pick this up on their next launch...");
  const res = runClaude(["update"], { stdio: "inherit" });
  if (res.error) fail(`Could not start "claude": ${res.error.message}. Is Claude Code installed?`);
  process.exit(res.status ?? 0);
}

function cmdDoctor() {
  const claude = runClaude(["--version"], { encoding: "utf8" });
  const claudeOk = claude.status === 0;
  ok(`claude binary:   ${claudeOk ? `OK (${claude.stdout.trim()})` : "NOT FOUND — install Claude Code first"}`);
  ok(`profiles dir:    ${PROFILES_DIR}`);
  ok(`launchers dir:   ${BIN_DIR} ${binDirOnPath() ? "(on PATH)" : "(NOT on PATH — run: ccm setup-path)"}`);
  const profiles = listProfiles();
  ok(`profiles:        ${profiles.length === 0 ? "none" : profiles.map((p) => p.name).join(", ")}`);
  ok(`updates:         shared binary — profiles never self-update; run "ccm update" (or update the original claude)`);
  if (process.platform === "darwin") {
    ok(`macOS note:      logins share the Keychain; for two accounts use "claude setup-token" + "ccm token <name>".`);
  }
}

function cmdSetupPath() {
  const { changed, note } = setupPath();
  ok(changed ? `Added ${BIN_DIR} to PATH. ${note}` : note);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    switch (cmd) {
      case "add":
        return cmdAdd(rest.filter((a) => !a.startsWith("--"))[0], {
          linkDefault: rest.includes("--link-default"),
          copyDefault: rest.includes("--copy-default"),
        });
      case "list":
      case "ls":
        return cmdList();
      case "remove":
      case "rm":
        return cmdRemove(rest.filter((a) => a !== "--purge")[0], rest.includes("--purge"));
      case "run":
        return process.exit(runProfile(rest[0], rest.slice(1)));
      case "token":
        return await cmdToken(rest.filter((a) => a !== "--clear")[0], rest.includes("--clear"));
      case "update":
        return cmdUpdate();
      case "setup-path":
        return cmdSetupPath();
      case "doctor":
        return cmdDoctor();
      case "-v":
      case "--version":
        return ok(VERSION);
      case undefined:
      case "help":
      case "-h":
      case "--help":
        return ok(HELP);
      default:
        fail(`Unknown command "${cmd}". Run "ccm help".`);
    }
  } catch (err) {
    fail(err.message);
  }
}

main();

import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_CLAUDE_DIR,
  DEFAULT_CLAUDE_JSON,
  PROFILES_DIR,
  launcherName,
  profileDir,
  validateName,
} from "./paths.js";
import { runClaude } from "./claude-bin.js";
import { TOKEN_FILE, removeLauncher, writeLauncher } from "./shims.js";

// Marks a profile whose launcher uses the DEFAULT Claude installation
// (no CLAUDE_CONFIG_DIR). The profile dir holds only this marker.
export const LINK_MARKER = ".ccm-linked-default";

// Ephemeral/locked-while-running dirs that are pointless to copy.
const COPY_SKIP = new Set(["cache", "daemon", "ide", "paste-cache", "shell-snapshots", "telemetry"]);

export function isLinked(name) {
  return fs.existsSync(path.join(profileDir(name), LINK_MARKER));
}

export function listProfiles() {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs
    .readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(PROFILES_DIR, entry.name);
      return {
        name: entry.name,
        dir,
        linked: fs.existsSync(path.join(dir, LINK_MARKER)),
        loggedIn: fs.existsSync(path.join(dir, ".credentials.json")),
        hasToken: fs.existsSync(path.join(dir, TOKEN_FILE)),
        launcher: launcherName(entry.name),
      };
    });
}

export function profileExists(name) {
  return fs.existsSync(profileDir(name));
}

export function addProfile(name, { linkDefault = false, copyDefault = false } = {}) {
  const invalid = validateName(name);
  if (invalid) throw new Error(invalid);
  if (linkDefault && copyDefault) throw new Error("--link-default and --copy-default are mutually exclusive.");

  const dir = profileDir(name);
  const existed = fs.existsSync(dir);

  if (existed) {
    // Re-running add regenerates the launcher; changing the profile's kind is not allowed.
    if (linkDefault !== isLinked(name)) {
      throw new Error(
        `Profile "${name}" already exists as a ${isLinked(name) ? "linked" : "normal"} profile. ` +
          `Remove it first: ccm remove ${name}${isLinked(name) ? "" : " [--purge]"}`
      );
    }
    if (copyDefault) {
      throw new Error(`Profile "${name}" already exists — refusing to overwrite it with a copy of the default.`);
    }
  }

  fs.mkdirSync(dir, { recursive: true });

  if (linkDefault) {
    fs.writeFileSync(path.join(dir, LINK_MARKER), "This profile uses the default Claude installation.\n");
  } else if (copyDefault) {
    if (!fs.existsSync(DEFAULT_CLAUDE_DIR)) {
      throw new Error(`No default Claude installation found at ${DEFAULT_CLAUDE_DIR} — nothing to copy.`);
    }
    fs.cpSync(DEFAULT_CLAUDE_DIR, dir, {
      recursive: true,
      force: true,
      filter: (src) => {
        const rel = path.relative(DEFAULT_CLAUDE_DIR, src);
        const top = rel.split(path.sep)[0];
        return !COPY_SKIP.has(top);
      },
    });
    // With CLAUDE_CONFIG_DIR set, claude reads .claude.json from inside the dir.
    if (fs.existsSync(DEFAULT_CLAUDE_JSON)) {
      fs.copyFileSync(DEFAULT_CLAUDE_JSON, path.join(dir, ".claude.json"));
    }
  }

  writeLauncher(name, { linked: linkDefault });
  return { dir, launcher: launcherName(name), existed };
}

export function removeProfile(name, { purge = false } = {}) {
  const invalid = validateName(name);
  if (invalid) throw new Error(invalid);
  if (!profileExists(name)) throw new Error(`Profile "${name}" does not exist.`);
  removeLauncher(name);
  if (purge) fs.rmSync(profileDir(name), { recursive: true, force: true });
  return { purged: purge, dir: profileDir(name) };
}

// One-off run without needing the launcher on PATH: ccm run <name> [claude args]
export function runProfile(name, args) {
  const invalid = validateName(name);
  if (invalid) throw new Error(invalid);
  if (!profileExists(name)) throw new Error(`Profile "${name}" does not exist. Create it with: ccm add ${name}`);

  const env = { ...process.env };
  if (isLinked(name)) {
    // Linked profile = the default installation; leave the environment as-is.
    delete env.CLAUDE_CONFIG_DIR;
  } else {
    env.CLAUDE_CONFIG_DIR = profileDir(name);
    // Same rule as the shims: isolated profiles never self-update the shared binary.
    env.DISABLE_AUTOUPDATER = "1";
    const tokenPath = path.join(profileDir(name), TOKEN_FILE);
    if (fs.existsSync(tokenPath)) {
      env.CLAUDE_CODE_OAUTH_TOKEN = fs.readFileSync(tokenPath, "utf8").trim();
    }
  }
  const res = runClaude(args, { stdio: "inherit", env });
  if (res.error) throw new Error(`Could not start "claude": ${res.error.message}. Is Claude Code installed?`);
  return res.status ?? 0;
}

// macOS multi-account workaround: store a long-lived token from `claude setup-token`.
export function setToken(name, token) {
  const invalid = validateName(name);
  if (invalid) throw new Error(invalid);
  if (!profileExists(name)) throw new Error(`Profile "${name}" does not exist. Create it with: ccm add ${name}`);
  if (isLinked(name)) {
    throw new Error(`Profile "${name}" is linked to the default installation — it uses the default login, no token needed.`);
  }
  const tokenPath = path.join(profileDir(name), TOKEN_FILE);
  if (token === null) {
    fs.rmSync(tokenPath, { force: true });
    return { cleared: true };
  }
  fs.writeFileSync(tokenPath, token.trim() + "\n", { mode: 0o600 });
  return { cleared: false };
}

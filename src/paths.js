import os from "node:os";
import path from "node:path";

export const IS_WIN = process.platform === "win32";

// CCM_HOME overrides the base dir (used by the test suite to sandbox everything).
const HOME = process.env.CCM_HOME || os.homedir();

export const CCM_ROOT = path.join(HOME, ".ccm");
// The default (non-ccm) Claude Code installation, used by --link-default / --copy-default.
export const DEFAULT_CLAUDE_DIR = path.join(HOME, ".claude");
export const DEFAULT_CLAUDE_JSON = path.join(HOME, ".claude.json");
export const PROFILES_DIR = path.join(CCM_ROOT, "profiles");
export const BIN_DIR = path.join(CCM_ROOT, "bin");

export function profileDir(name) {
  return path.join(PROFILES_DIR, name);
}

export function launcherName(name) {
  return `claude-${name}`;
}

// Profile names become folder names and command names, so keep them strict.
export function validateName(name) {
  if (!name) return "Profile name is required.";
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(name)) {
    return `Invalid profile name "${name}". Use letters, numbers, "-" or "_" (max 32 chars, must start with a letter or number).`;
  }
  return null;
}

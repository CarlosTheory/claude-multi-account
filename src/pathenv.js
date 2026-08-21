import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { BIN_DIR, IS_WIN } from "./paths.js";

export function binDirOnPath() {
  const entries = (process.env.PATH ?? "").split(path.delimiter);
  const target = path.resolve(BIN_DIR).toLowerCase();
  return entries.some((entry) => {
    if (!entry) return false;
    return path.resolve(entry).toLowerCase() === target;
  });
}

// Adds ~/.ccm/bin to the user's PATH permanently.
// Windows: user-scoped Path in the registry (new terminals pick it up).
// Unix: appends an export line to the shell rc file(s) that exist.
export function setupPath() {
  if (IS_WIN) {
    const script = `
$binDir = '${BIN_DIR.replaceAll("'", "''")}'
$current = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = ($current -split ';') | Where-Object { $_ -ne '' }
if ($parts -contains $binDir) { Write-Output 'already'; exit 0 }
[Environment]::SetEnvironmentVariable('Path', ($current.TrimEnd(';') + ';' + $binDir), 'User')
Write-Output 'added'
`;
    const res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
    });
    if (res.status !== 0) {
      throw new Error(`Could not update user PATH: ${res.stderr || res.stdout || "unknown error"}`);
    }
    return {
      changed: res.stdout.trim() === "added",
      note: "Open a NEW terminal for the PATH change to take effect.",
    };
  }

  const exportLine = `export PATH="$HOME/.ccm/bin:$PATH" # added by ccm`;
  const rcCandidates = [".zshrc", ".bashrc", ".profile"];
  const updated = [];
  for (const rc of rcCandidates) {
    const rcPath = path.join(os.homedir(), rc);
    if (!fs.existsSync(rcPath)) continue;
    const content = fs.readFileSync(rcPath, "utf8");
    if (content.includes("/.ccm/bin")) continue;
    fs.appendFileSync(rcPath, `\n${exportLine}\n`);
    updated.push(rc);
  }
  if (updated.length === 0 && !binDirOnPath()) {
    // No rc file found at all — create .profile as a safe default.
    const rcPath = path.join(os.homedir(), ".profile");
    fs.appendFileSync(rcPath, `\n${exportLine}\n`);
    updated.push(".profile");
  }
  return {
    changed: updated.length > 0,
    note: updated.length
      ? `Updated ${updated.join(", ")}. Restart your shell or run: export PATH="$HOME/.ccm/bin:$PATH"`
      : "PATH already configured.",
  };
}

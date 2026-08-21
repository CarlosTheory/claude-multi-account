import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const IS_WIN = process.platform === "win32";
const CCM_BIN = fileURLToPath(new URL("../bin/ccm.js", import.meta.url));

// A sandbox is a throwaway HOME: ccm sees it via CCM_HOME, so ~/.ccm and the
// "default installation" (~/.claude) both live inside it. A fake `claude`
// executable on PATH echoes back the env/args it received, which lets tests
// assert exactly what the shims and `ccm run` pass through.
export function makeSandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ccm-test-"));
  const fakeBin = path.join(home, "fakebin");
  fs.mkdirSync(fakeBin, { recursive: true });

  // The fake claude is a Node script (deterministic env expansion on every OS)
  // fronted by the same launcher flavors a real claude install would have.
  fs.writeFileSync(
    path.join(fakeBin, "fake-claude.js"),
    `const e = process.env;
console.log(
  "FAKE_CLAUDE CONFIG=" + (e.CLAUDE_CONFIG_DIR ?? "") +
  " AUTOUPD=" + (e.DISABLE_AUTOUPDATER ?? "") +
  " TOKEN=" + (e.CLAUDE_CODE_OAUTH_TOKEN ?? "") +
  " ARGS=" + process.argv.slice(2).join(" ")
);
process.exit(Number(e.FAKE_CLAUDE_EXIT ?? 0));
`
  );
  fs.writeFileSync(
    path.join(fakeBin, "claude"),
    `#!/bin/sh
exec node "$(dirname "$0")/fake-claude.js" "$@"
`,
    { mode: 0o755 }
  );
  if (IS_WIN) {
    fs.writeFileSync(
      path.join(fakeBin, "claude.cmd"),
      `@echo off\r
node "%~dp0fake-claude.js" %*\r
exit /b %ERRORLEVEL%\r
`
    );
  }

  return {
    home,
    fakeBin,
    ccmRoot: path.join(home, ".ccm"),
    binDir: path.join(home, ".ccm", "bin"),
    profilesDir: path.join(home, ".ccm", "profiles"),
    defaultClaudeDir: path.join(home, ".claude"),
    defaultClaudeJson: path.join(home, ".claude.json"),
    cleanup() {
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

// Env for spawned processes: sandboxed home, fake claude first on PATH, and
// update-related vars neutralized so the host machine can't affect assertions.
export function sandboxEnv(sb, extra = {}) {
  const env = { ...process.env, CCM_HOME: sb.home, ...extra };
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = sb.fakeBin + path.delimiter + env[pathKey];
  delete env.CLAUDE_CONFIG_DIR;
  delete env.DISABLE_AUTOUPDATER;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}

export function runCcm(sb, args, { env = {}, input } = {}) {
  const res = spawnSync(process.execPath, [CCM_BIN, ...args], {
    encoding: "utf8",
    input,
    env: sandboxEnv(sb, env),
  });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "", out: (res.stdout ?? "") + (res.stderr ?? "") };
}

// Run one of the launchers ccm generated, through the real interpreter for
// its flavor (cmd.exe / powershell.exe / sh), against the fake claude.
export function runShim(sb, launcherBase, flavor, args = [], env = {}) {
  const fullEnv = sandboxEnv(sb, env);
  let res;
  if (flavor === "cmd") {
    res = spawnSync("cmd.exe", ["/d", "/s", "/c", `${launcherBase}.cmd`, ...args], { encoding: "utf8", env: fullEnv });
  } else if (flavor === "ps1") {
    res = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", `${launcherBase}.ps1`, ...args],
      { encoding: "utf8", env: fullEnv }
    );
  } else {
    // bash treats backslashes as escapes — hand it a forward-slash path.
    res = spawnSync(shPath(), [launcherBase.replaceAll("\\", "/"), ...args], { encoding: "utf8", env: fullEnv });
  }
  return { code: res.status, out: (res.stdout ?? "") + (res.stderr ?? ""), error: res.error };
}

// On Windows, `bash.exe` on PATH is usually the WSL stub, which can't run
// Windows-path scripts — use Git Bash explicitly.
let cachedSh;
export function shPath() {
  if (cachedSh !== undefined) return cachedSh;
  if (!IS_WIN) {
    cachedSh = "sh";
    return cachedSh;
  }
  const candidates = [
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Git", "bin", "bash.exe"),
  ];
  cachedSh = candidates.find((c) => fs.existsSync(c)) ?? null;
  return cachedSh;
}

export function hasSh() {
  const sh = shPath();
  return Boolean(sh) && spawnSync(sh, ["-c", "true"]).status === 0;
}

// Populate a fake "default" Claude installation to test --copy-default / --link-default.
export function seedDefaultInstall(sb) {
  const d = sb.defaultClaudeDir;
  fs.mkdirSync(path.join(d, "plugins"), { recursive: true });
  fs.mkdirSync(path.join(d, "projects", "proj-a"), { recursive: true });
  fs.mkdirSync(path.join(d, "shell-snapshots"), { recursive: true }); // must be skipped by copy
  fs.mkdirSync(path.join(d, "telemetry"), { recursive: true }); // must be skipped by copy
  fs.writeFileSync(path.join(d, "settings.json"), `{"theme":"dark"}\n`);
  fs.writeFileSync(path.join(d, ".credentials.json"), `{"fake":"creds"}\n`);
  fs.writeFileSync(path.join(d, "plugins", "plugin.txt"), "plugin-data\n");
  fs.writeFileSync(path.join(d, "projects", "proj-a", "history.jsonl"), `{"fake":"history"}\n`);
  fs.writeFileSync(path.join(d, "shell-snapshots", "snap.sh"), "ephemeral\n");
  fs.writeFileSync(sb.defaultClaudeJson, `{"fake":"claude-json"}\n`);
}

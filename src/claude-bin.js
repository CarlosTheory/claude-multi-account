import { spawnSync } from "node:child_process";
import { IS_WIN } from "./paths.js";

// Resolve the real claude executable. On Windows `claude` may be a native
// .exe (installer) or an npm .cmd shim; .cmd can't be spawned directly
// without a shell, so route it through cmd.exe explicitly (args stay an
// array — no shell string concatenation).
export function claudeCommand(args) {
  if (!IS_WIN) return { file: "claude", args };

  const res = spawnSync("where.exe", ["claude"], { encoding: "utf8" });
  const found = res.status === 0 ? res.stdout.split(/\r?\n/).filter(Boolean) : [];
  // where.exe lists matches in PATH search order — honor it, like the shell
  // would, taking the first entry Windows can actually execute.
  for (const f of found) {
    if (/\.(exe|com)$/i.test(f)) return { file: f, args };
    if (/\.(cmd|bat)$/i.test(f)) return { file: "cmd.exe", args: ["/d", "/s", "/c", f, ...args] };
  }
  return { file: "claude", args }; // let spawn report the real error
}

export function runClaude(args, options = {}) {
  const cmd = claudeCommand(args);
  return spawnSync(cmd.file, cmd.args, options);
}

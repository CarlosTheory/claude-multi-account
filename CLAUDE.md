# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`ccm` (Claude Code Multi) — a zero-dependency Node.js (>= 18, ESM) CLI that
manages multiple isolated Claude Code profiles on one machine. Each profile is
a folder under `~/.ccm/profiles/<name>` used as `CLAUDE_CONFIG_DIR`, plus a
generated `claude-<name>` launcher in `~/.ccm/bin`.

## Commands

```sh
node bin/ccm.js <cmd>   # run the CLI from source (no build step)
npm install -g .        # install the ccm command globally
npm test                # node --test  (node's built-in runner, discovers test/)
```

Run a single test file: `node --test test/cli.integration.test.js`.

The integration suite (`test/cli.integration.test.js` + `test/helpers.js`) is
fully sandboxed: it sets `CCM_HOME` to a temp dir (paths.js honors that
override — keep it working) and puts a fake `claude` (a Node script behind
.cmd/sh wrappers) first on PATH, which echoes back the env it received. That
lets tests spawn the real CLI end-to-end, execute the generated .cmd/.ps1/sh
shims through their real interpreters (cmd.exe, powershell.exe, Git Bash —
found explicitly at Program Files\Git because PATH `bash.exe` is the WSL stub),
and assert on CLAUDE_CONFIG_DIR / DISABLE_AUTOUPDATER / token / exit codes.
Never write tests that touch the real `~/.ccm` or `~/.claude`.

## Architecture

- `bin/ccm.js` — command dispatcher, help text, `doctor`. All user-facing
  output lives here; `src/` modules throw plain `Error`s and never print.
- `src/paths.js` — single source of truth for `~/.ccm` layout, `IS_WIN`,
  profile-name validation, `claude-<name>` launcher naming.
- `src/shims.js` — generates/removes launcher scripts. On Windows it writes an
  npm-style triple shim (extensionless sh for Git Bash, `.cmd`, `.ps1`); on
  Unix a single `#!/bin/sh` script (0755). Shims hardcode the absolute profile
  path and are regenerated (never edited) by `ccm add`.
- `src/profiles.js` — profile CRUD + `runProfile`. Profiles are discovered by
  listing `~/.ccm/profiles/` (no registry/metadata file — the directory IS the
  state). Login state is inferred from `.credentials.json` in the profile.
  Two special kinds: LINKED profiles (`--link-default`) hold only a
  `.ccm-linked-default` marker and their launchers leave the environment
  untouched (never symlink to `~/.claude` — purge must not be able to reach the
  real installation); COPIED profiles (`--copy-default`) are seeded via
  `cpSync` from `~/.claude` + `~/.claude.json` (which claude reads from inside
  `CLAUDE_CONFIG_DIR` when set), skipping the ephemeral dirs in `COPY_SKIP`.
- `src/claude-bin.js` — resolves the real `claude` executable. On Windows,
  `claude` may be a native `.exe` or an npm `.cmd` shim; `.cmd` must be routed
  through `cmd.exe` explicitly. Never spawn `claude` with `shell: true` and an
  args array (unescaped-args vulnerability — this module exists to avoid it).
- `src/pathenv.js` — PATH detection and permanent PATH setup (Windows:
  user-scoped registry Path via PowerShell; Unix: append to existing rc files).

## Key constraints

- Zero runtime dependencies and no build step — keep it that way.
- Everything must work on Windows (CMD/PowerShell/Git Bash), macOS and Linux;
  any launcher-related change has to update all three Windows shim variants in
  `src/shims.js` consistently.
- macOS cannot isolate `/login` credentials (shared Keychain). The supported
  path there is a per-profile token file (`.ccm-oauth-token`, mode 0600) that
  shims export as `CLAUDE_CODE_OAUTH_TOKEN` — see `ccm token` and README.
- `ccm remove` keeps profile data by default; deletion requires the explicit
  `--purge` flag. Don't weaken that.
- Update model: one shared `claude` binary for all profiles. Isolated-profile
  shims and `ccm run` set `DISABLE_AUTOUPDATER=1` so profiles never self-update
  (avoids concurrent-update/lock errors); updates flow through the original
  installation or `ccm update` only. Linked launchers must NOT set that var.

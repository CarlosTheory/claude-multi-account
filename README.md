# ccm — Run Multiple Claude Code Accounts on One Machine

**Claude Code multi-account / profile manager for Windows, macOS and Linux.**
Keep your **work** and **personal** Claude accounts fully separated on the same
computer — each profile gets its own login, settings, plugins, MCP servers and
conversation history, plus its own launcher command:

```
ccm add personal   →  claude-personal
ccm add work       →  claude-work
```

Two terminals, two accounts, side by side. No logging in and out, no shared
history, no mixed billing. Zero dependencies, Node.js >= 18, MIT licensed.

## Why?

Claude Code stores everything (OAuth login, settings, plugins, MCP servers,
projects history) in a single per-user config. If you have **two Anthropic
accounts** — company and personal, or one per client — switching means logging
out and back in, and everything else (plugins, MCP, history) stays mixed.

`ccm` fixes that with the **official `CLAUDE_CONFIG_DIR` mechanism**: one
folder per profile under `~/.ccm/profiles/<name>`, and a tiny generated
`claude-<name>` launcher that points Claude Code at it. Nothing is patched,
proxied or reverse-engineered — each launcher is a few lines of shell script
you can read.

## Quick start

```sh
npm install -g ccm-claude
ccm setup-path        # adds ~/.ccm/bin to your PATH (once) — then open a new terminal

ccm add work          # create the profile + claude-work launcher
claude-work           # first run: log in with your work account — done
```

Run `claude-work` for work, plain `claude` (or another profile) for everything
else. Both can run **at the same time**.

## Commands

| Command | What it does |
|---|---|
| `ccm add <name>` | Create an isolated profile and its `claude-<name>` launcher |
| `ccm add <name> --link-default` | Launcher for your **original** installation, unchanged (same account/data) |
| `ccm add <name> --copy-default` | Seed the profile with a **copy** of your original (settings, plugins, history, login), then independent |
| `ccm list` | All profiles + login state |
| `ccm where <name>` | Print the exact folder holding the profile's data (alias: `ccm path`) |
| `ccm run <name> [args...]` | Run a profile without the launcher/PATH |
| `ccm token <name>` | Store a long-lived OAuth token (macOS multi-account — see below) |
| `ccm update` | Update the shared `claude` binary — all profiles get it |
| `ccm remove <name> [--purge]` | Remove the launcher (and with `--purge`, the data) |
| `ccm setup-path` | Add `~/.ccm/bin` to your PATH permanently |
| `ccm doctor` | Check installation, PATH and profiles |

Launcher arguments pass straight through to Claude Code:
`claude-work --resume`, `claude-personal -p "explain this repo"`, etc.

## How it works

- Each profile folder **is** a `CLAUDE_CONFIG_DIR`: credentials
  (`.credentials.json`), `settings.json`, `.claude.json`, plugins, MCP
  registrations, `projects/` history — all isolated per profile.
- Launchers are npm-style shims: `.cmd` + `.ps1` + sh on Windows (works from
  CMD, PowerShell and Git Bash), a single `#!/bin/sh` script on macOS/Linux.
- **Updates are shared and safe**: every launcher runs the same `claude`
  binary, so one update (auto-update of your original installation, `brew
  upgrade`, or `ccm update`) upgrades all profiles at once. Profile launchers
  set `DISABLE_AUTOUPDATER=1`, so concurrent instances never race to modify
  the shared binary — a real crash scenario on Windows.
- Your original installation is never touched. `--link-default` uses no
  symlinks, so even `ccm remove --purge` cannot reach your real `~/.claude`.

```
~/.ccm/
  bin/                  generated launchers (on your PATH)
  profiles/work/        CLAUDE_CONFIG_DIR for "work"
  profiles/personal/    CLAUDE_CONFIG_DIR for "personal"
```

## macOS: two accounts at once

On Windows and Linux, `/login` in each profile is all you need — credentials
live inside the profile folder. On **macOS**, Claude Code stores OAuth logins
in the shared system Keychain, so two profiles using `/login` would overwrite
each other. Use a long-lived token per profile instead:

```sh
claude setup-token     # log in as the account you want, copy the token
ccm token work         # paste it — stored in the profile with 0600 perms
```

The `claude-work` launcher then exports it as `CLAUDE_CODE_OAUTH_TOKEN`
automatically, and both accounts work simultaneously.

## FAQ

**Does this violate anything?** No — `CLAUDE_CONFIG_DIR` is Claude Code's
documented, supported way to relocate its configuration. `ccm` just manages
the folders and launchers for you.

**How do I check which account a session uses?** Type `/status` inside the
session, or run `ccm list` to see the login state of every profile.

**Can profiles have different plugins / MCP servers?** Yes — that's the
point. Everything user-scoped is per profile. Project-scoped files
(`.claude/` inside a repo) are shared, as they should be.

**Does my existing setup survive?** Untouched. Profiles live in `~/.ccm`,
your original `~/.claude` stays where it is. Use `--link-default` if you want
a launcher for it, or `--copy-default` to fork it into a new profile.

**Uninstall?** `npm uninstall -g ccm-claude`, delete `~/.ccm`, remove the
PATH entry.

**Install from source?** `git clone
https://github.com/carlostheory/claude-multi-account.git && cd
claude-multi-account && npm install -g .`

## Development

```sh
npm test    # 50 tests: sandboxed end-to-end CLI runs + the generated
            # launchers executed through real cmd.exe / PowerShell / Git Bash
```

The test suite never touches your real `~/.claude` or `~/.ccm` — see
`test/helpers.js`.

---

*Keywords: Claude Code multiple accounts, Claude Code profile manager, switch
Claude accounts, work and personal Claude Code, CLAUDE_CONFIG_DIR, Claude
Code Windows macOS Linux, Anthropic CLI multi-account.*

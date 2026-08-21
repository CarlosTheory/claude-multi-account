# ccm — Claude Code Multi

Run multiple Claude Code accounts on one machine, fully separated. Each profile
gets its own config folder (login, settings, plugins, MCP servers, history) and
its own launcher command:

```
ccm add ca      →  claude-ca      (personal account)
ccm add work    →  claude-work    (work account)
```

Works on Windows, macOS and Linux. Zero dependencies, Node.js >= 18.

## How it works

Claude Code supports the official `CLAUDE_CONFIG_DIR` environment variable to
relocate everything it stores. `ccm` creates one folder per profile under
`~/.ccm/profiles/<name>` and generates a `claude-<name>` launcher in
`~/.ccm/bin` that sets the variable and hands off to `claude`. Nothing is
patched or proxied — each launcher is a tiny generated script.

On Windows each launcher is a triple shim (`.cmd` + `.ps1` + sh) so it works
from CMD, PowerShell and Git Bash, same as npm's own shims.

## Install

```sh
git clone <this-repo> && cd claude-multi-account
npm install -g .
ccm setup-path   # adds ~/.ccm/bin to your PATH (once, then open a new terminal)
```

## Usage

```sh
ccm add ca              # create profile + claude-ca launcher
claude-ca               # first run: log in with the account for this profile
ccm add work            # second profile, second account
claude-work

ccm add main --link-default   # launcher for your ORIGINAL claude, unchanged
ccm add ca --copy-default     # new profile seeded with a full copy of your
                              # original (account, plugins, history), then independent

ccm list                # profiles + login state
ccm run ca [args...]    # run a profile without the launcher/PATH
ccm remove ca           # remove launcher, keep data
ccm remove ca --purge   # remove launcher AND delete all profile data
ccm doctor              # check claude binary, PATH, profiles
ccm update              # update the shared claude binary (all profiles get it)
```

Any arguments after the launcher name pass straight through to `claude`
(`claude-ca --resume`, `claude-work -p "..."`, etc.).

### Updates

All launchers share ONE `claude` binary, so an update anywhere updates every
profile at once — profiles pick it up on their next launch. To keep instances
from fighting over that shared binary, isolated-profile launchers run with
`DISABLE_AUTOUPDATER=1` (no concurrent-update or lock errors when several
profiles run at the same time). Updates happen in exactly one place: your
original installation's own auto-updater (plain `claude` or a `--link-default`
launcher), or manually via `ccm update`.

### Keeping your original installation

Nothing `ccm` does touches your existing `claude` — new profiles simply point
elsewhere. Two flags make the relationship explicit:

- `--link-default`: the launcher runs your original installation as-is (no
  isolation, same account/data). Running `claude` directly keeps working
  exactly as before. `ccm remove --purge` on a linked profile only deletes the
  marker folder, never your real `~/.claude`.
- `--copy-default`: seeds the new profile with a copy of your original
  installation (settings, plugins, history, login — skipping ephemeral caches),
  after which the two are fully independent. Note this duplicates the size of
  `~/.claude` on disk.

## macOS: two accounts at once

On Linux and Windows, credentials live inside each profile folder, so `/login`
in each profile gives true multi-account. On macOS, OAuth logins are stored in
the shared system Keychain, so two profiles logging in via `/login` would
overwrite each other. Use a long-lived token per profile instead:

```sh
claude setup-token      # log in as the account you want, copy the token
ccm token ca            # paste it — stored in the profile (0600)
```

The `claude-ca` launcher then exports it as `CLAUDE_CODE_OAUTH_TOKEN`
automatically. Repeat with the other account for `work`.

## Where things live

```
~/.ccm/
  bin/                  generated launchers (add this to PATH)
  profiles/<name>/      CLAUDE_CONFIG_DIR for that profile:
                        .claude.json, .credentials.json, settings.json,
                        plugins, projects/ (history), sessions/, agents/ ...
```

Uninstall: `npm uninstall -g ccm-cli`, delete `~/.ccm`, and remove the PATH
entry added by `ccm setup-path`.

# Claude Code mods

Small plugins of function hooks that change how [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) looks and behaves. There's a one-line dock above the prompt, usage bars in the footer, and live task progress, plus a cost and habits coach, next-task suggestions, a PR desk and more. Type `/mods` (or click **M** in the dock) to see every mod, read what it does, and switch it on or off.

| Mod | What it does | Use it with |
|---|---|---|
| mod-hub | The dock (**P N C PR T M ▾**), one hover card, a one-click Background tasks button, the mods page with on/off switches | the dock, `/mods`, `/mods-review` |
| mission-control | Live plan, % done, time left and a "now" line for long tasks, plus how far off past estimates were | **P**, `/mission` |
| next-tasks | Three suggested next tasks after longer replies; folds away after 10 s untouched | **N**, `/next` |
| coach | Cache, context, cost, habits and one "do next", plus architect lessons | **C**, `/coach` |
| pr-desk | Your open PRs with checks, merge state and preview links | **PR**, `/prs` |
| usage-meter | 5-hour and weekly usage bars in the footer, always on (reset times in the **C** card) | footer |
| turn-timer | How long every prompt took, saved in the chat, plus history | `/timings`, `/timings all` |
| collision-guard | Warns when parallel sessions edit the same file or version | toasts, `/collisions` |

Each mod's folder has a README with the details.

## Install

Needs Claude Code 2.1.28x or later (function hooks).

**Windows** (PowerShell):
```powershell
git clone https://github.com/eshin087/claude-code-mods "$HOME\Desktop\Claude Code\mods"
& "$HOME\Desktop\Claude Code\mods\install.ps1"
```

**macOS / Linux:**
```bash
git clone https://github.com/eshin087/claude-code-mods ~/claude-code-mods
~/claude-code-mods/install.sh
```

Then start a new Claude Code session, or reopen the app.

**What the install script changes:** it adds three entries to the `env` block of `~/.claude/settings.json`, and backs the file up to `settings.json.bak` first. Everything else is kept.

| Entry | What it does |
|---|---|
| `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` | Turns function hooks on. |
| `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` | Open sessions reload a mod as soon as its files change. |
| `CLAUDE_CODE_PLUGIN_DIRS` | Every mod folder here, separated by `;` on Windows or `:` elsewhere. `mod-hub` comes first: the hub can only switch off mods that load after it. |

**PR Desk:** copy `pr-desk/config.example.json` to `pr-desk/config.json` and list your repos. That file stays out of git.

## Keep computers in sync

Run `git pull` in the mods folder. Open sessions reload the changed mods by themselves, and new sessions get them on start. A mod removed from the repo drops out by itself: the folder goes with the pull, and the hub takes it out of your settings at the next session start. Run the install script again when a new mod folder was added, or when the hub warns that a mod loads before it (installs older than the per-computer switch listed folders alphabetically).

Which mods are on or off is never synced: each computer keeps its own list (see Data).

## Testing

See [TESTING.md](TESTING.md) for how to run the automated tests (`claude plugin test <mod>`), the manual checklist, and the bug log.

## Data

Saved history lives in `~/.claude/mods-data/<mod>/` on each computer, and isn't synced. Delete a folder to wipe that mod's history. The hub's on/off switches live there too, in `mod-hub/off.json`.

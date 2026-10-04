# Claude Code mods

Small plugins of function hooks that change how [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) looks and behaves. There's a one-line dock above the prompt, usage bars in the footer, and live task progress, plus a cost and habits coach, next-task suggestions, a PR desk and more. Type `/mods` (or click **M** in the dock) to see every mod, read what it does, and switch it on or off.

| Mod | What it does | Use it with |
|---|---|---|
| mod-hub | The dock (**P N C PR M ▾**), hover cards, the mods page with on/off switches | the dock, `/mods`, `/mods-review` |
| mission-control | Live plan, % done, time left and a "now" line for long tasks | **P**, `/mission` |
| next-tasks | Three suggested next tasks after longer replies | **N**, `/next` |
| coach | Cache, context, cost, habits and one "do next", plus architect lessons | **C**, `/coach` |
| pr-desk | Your open PRs with checks, merge state and preview links | **PR**, `/prs` |
| usage-meter | 5-hour and weekly usage bars in the footer (hover for reset times) | footer |
| turn-timer | How long every prompt took, saved in the chat, plus history | `/timings`, `/timings all` |
| collision-guard | Warns when parallel sessions edit the same file or version | toasts, `/collisions` |
| plan-autopilot | Plans on Sonnet, builds on Opus once you approve | Plan mode |

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
| `CLAUDE_CODE_PLUGIN_DIRS` | Every mod folder here, separated by `;` on Windows or `:` elsewhere. |

**PR Desk:** copy `pr-desk/config.example.json` to `pr-desk/config.json` and list your repos. That file stays out of git.

## Keep computers in sync

Run `git pull` in the mods folder. Open sessions reload the changed mods by themselves, and new sessions get them on start. Run the install script again only when a new mod folder was added.

## Testing

See [TESTING.md](TESTING.md) for how to run the automated tests (`claude plugin test <mod>`), the manual checklist, and the bug log.

## Data

Saved history lives in `~/.claude/mods-data/<mod>/` on each computer, and isn't synced. Delete a folder to wipe that mod's history.

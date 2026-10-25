# Claude Code mods

Small plugins of function hooks for [Claude Code](https://docs.claude.com/en/docs/claude-code/overview): a hub to see and switch them, two about your plan's usage limits (so you never need the usage button), one that times every prompt, and two that help you keep track of many chats at once. Type `/mods` to see every mod and switch it on or off.

| Mod | What it does | Use it with |
|---|---|---|
| [hub](hub/README.md) | `/mods`: every mod, what it does, and an on/off switch for each (kept on this computer only) | `/mods` |
| [limits](limits/README.md) | Your 5-hour and weekly limits in the footer next to the model picker, with the time left to the 5-hour reset: `5h 22% 3h27 · w 76%` | footer |
| [pace](pace/README.md) | What this chat has used (tokens, cost, % of each limit), and when the 5-hour and weekly limits run out at your current pace; a toast warns when one would run out before it resets | `/pace` (and **🔹P** in the terminal's footer) |
| [inbox](inbox/README.md) | Which of your chats, across every project, are waiting on you: an approval, a question, or your turn after a finished reply | `/inbox` |
| [askfirst](askfirst/README.md) | A switch that makes Claude ask its clarifying questions before starting a task, so you don't have to say "ask me any questions" every time | `/askfirst` (footer shows "ask first" while on) |
| [timings](timings/README.md) | How long each prompt took, its tokens and API cost, on the prompt's row and in a history pane with totals; past chats too | a small **🔸** button in the footer, `/timings` |

## Install

Needs Claude Code 2.1.299 or later (function hooks).

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

**What the install script changes:** it sets three entries in the `env` block of `~/.claude/settings.json`, and backs the file up to `settings.json.bak` first. Everything else is kept.

| Entry | What it does |
|---|---|
| `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` | Turns function hooks on. |
| `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` | Open sessions reload a mod as soon as its files change. |
| `CLAUDE_CODE_PLUGIN_DIRS` | Every mod folder here, separated by `;` on Windows or `:` elsewhere. `hub` comes first: it can only switch off mods that load after it. |

## Keep computers in sync

Run `git pull` in the mods folder. Open sessions reload the changed mods by themselves, and new sessions get them on start. Run the install script again whenever a mod folder is added or removed, so the settings list exactly the folders that are here.

**Coming from the first set of mods** (mod-hub, mission-control, coach and the rest)? They're gone from the repo. After pulling, run the install script once: it replaces the old list with `hub`, `limits`, `pace` and `timings`.

## Testing

See [TESTING.md](TESTING.md) for how to run the automated tests and what to check by hand.

## Data

Saved data lives in `~/.claude/mods-data/<mod>/` on each computer, and isn't synced: which mods are switched off (`hub/off.json`), the limits readings (with 8 days of history), the pace mod's warnings and each chat's timings. Delete a folder to wipe it.

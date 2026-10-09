# Mod Hub

**What it does:** one page listing every mod in your mods folder, what each does in detail, and an on/off switch.

**The dock:** one slim line just above the prompt, only when there's something to say:
```
◎ ━━━━━━──── 46% · 3/5 · ~8m  wiring the tile streamer…
```
- **While Claude is idle with a plan under way:** a solid bar, %, step and time left (these never get cut off), then the "now" line, trimmed with "…" when space runs out.
- **While Claude works:** nothing here; Mission Control's working row carries the progress.
- **When the plan finishes:** `✓ done 6m53s` until your next prompt.
- **No plan:** nothing above the prompt at all.

There are no tab buttons or hover cards: the engine can only draw a card inside the band above the prompt, which made the app's panel there grow. Each panel opens with its slash command instead: `/mission`, `/coach`, `/prs`, `/next`, `/mods`. Mission Control's working row also has a **plan ›** link.

**Review everything at once:** `/mods-review` opens Mods, Plan, Coach and PRs together (as tabs) and asks for next-task suggestions when there are none.

**The hub page:** type `/mods`. A pane opens with every mod, its version, a one-line summary, **Details** (this page) and **Turn off / Turn on**.

**How on/off works:** the switched-off mods are a list on this computer, `~/.claude/mods-data/mod-hub/off.json`. *Turn off* adds a mod to it and *Turn on* takes it out. Whenever a mod loads, the engine first asks the mods loaded before it (`plugin.register`), and the hub refuses any mod on the list, so none of its hooks, commands or tools run. The engine's log names each one: `refused by mod-hub: switched off in /mods`.
- The switch also saves the mod's `hooks/hooks.json` again, byte for byte. The new timestamp makes every session that watches the folder reload that mod at once (a session busy with a reply does it when the reply ends), and the reload asks the hub again. Any other session picks the change up when it starts.
- The switch covers every session on this computer. Nothing is deleted.
- **The hub must load first.** A mod can only be refused by mods that load before it, so `mod-hub` comes first in `CLAUDE_CODE_PLUGIN_DIRS`, and the install scripts put it there. If a switched-off mod loads ahead of the hub (older installs listed folders alphabetically), the hub says so in a toast: run the install script again.

**On/off and git:** switching changes no tracked file, so `git status` stays clean and on/off never travels through a commit or `git pull`: each computer keeps its own list. `claude plugin test` always runs a mod's real code, whether it's switched off or not.
- Older hubs switched a mod off by pointing its `hooks.json` at a stub (`hooks/off.tsx`). The hub moves any mod it finds like that onto the list and points `hooks.json` back at `register.tsx` by itself.
- Leftover `off.tsx` files are git-ignored and safe to delete.

**Removing a mod:** delete its folder (and commit that, so other computers lose it with their next `git pull`). At the next session start the hub sees the folder is gone and takes it out of `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (backed up to `settings.json.bak` first) and out of `off.json`, then says so in a toast. Only folders in this mods folder are touched; nothing else in your settings changes.

**Cost:** none. No model calls.

**Data saved:** `~/.claude/mods-data/mod-hub/off.json`, the mods switched off on this computer. It also edits `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`, only to take out a mod folder that is gone.

**Notes:** the hub can't switch itself off from the page. To remove it, delete or rename its folder. Without the hub nothing refuses the switched-off mods, so they all load.

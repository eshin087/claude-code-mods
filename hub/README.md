# Hub

**What it does:** `/mods` opens a page listing every mod in your mods folder: whether it's on, its version, what it does, **Details** (its README) and **Turn off / Turn on**. `/mods` again closes it.

**How on/off works:** the switched-off mods are a list on this computer, `~/.claude/mods-data/hub/off.json`. *Turn off* adds a mod to it and *Turn on* takes it out. Whenever a mod loads, the engine first asks the mods loaded before it, and the hub refuses any mod on the list, so none of its hooks, commands or tools run.
- The switch also saves the mod's `hooks/hooks.json` again, unchanged. The new timestamp makes every session that watches the folder reload that mod at once (a session busy with a reply does it when the reply ends), and the reload asks the hub again. Any other session picks the change up when it starts.
- The switch covers every session on this computer. Nothing is deleted, and no tracked file changes, so `git status` stays clean and on/off never travels through a commit or `git pull`.
- **The hub must load first.** A mod can only be refused by mods that load before it, so `hub` comes first in `CLAUDE_CODE_PLUGIN_DIRS`, and the install scripts put it there. If a switched-off mod loads ahead of the hub, the hub says so in a toast: run the install script again.

**Notes:** the hub can't switch itself off from its page. Without the hub nothing refuses the switched-off mods, so they all load.

**Cost:** none. No model calls.

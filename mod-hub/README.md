# Mod Hub

**What it does:** one page listing every mod in your mods folder, what each does in detail, and an on/off switch.

**The dock:** one line just above the prompt, always in the same place:
```
◎ ━━━━━━──── 46%  3/5 · ~8m  wiring the tile streamer…   P ●N C ●PR T M ▾
```
- **Left:** the running task as a solid bar, %, step and time left (these never get cut off), then the "now" line, which is trimmed with "…" when space runs out. When the task finishes it reads `✓ done 6m53s` until your next prompt.
- **Tabs:** one letter chip each. **P** plan · **N** next tasks · **C** coach · **PR** pull requests · **T** background tasks · **M** mods. A click opens that panel; a second click closes it. Clicking **N** with no suggestions yet asks for them.
- **T** opens the app's own **Background tasks** pane in one click (instead of two through the menus), and closes it on the next. If the app won't let a mod open it, a toast says so and points you to the menu.
- **Dot before a letter:**
  - green: that panel is open.
  - amber: something new (suggestions ready, a new coach tip, a PR failing or in conflict).
- **Hover a tab** (desktop) to see its card, framed in that tab's color, without opening anything. There is only ever **one** card, always in the same spot (above the right end of the dock), and it switches as you move between letters. Every line is cut with "…" instead of wrapping:
  - **P** (cyan): task, bar, %, step, time left, now, the step checklist, and how far off past estimates were.
  - **N** (amber): the three suggestions.
  - **C** (violet): cache and context bars, cost, usage limits with reset time, habits, what to do next.
  - **PR** (green): each PR's state and title.
  - **T** (orange): running agents, plus shells, monitors and workflows from the last reply.
  - **M** (pink): every mod, on or off.
- **How hover works:** the letters are drawn by a small surface module (`hooks/tabs.tsx`) that knows where the pointer is and tells the dock which tab it's over. The dock then draws the single card. On the terminal the tabs are plain buttons with shortcut keys and no hover card.
- **Keys** (terminal only): with the dock focused, p, n, c, r, t and m press the tabs.
- **▾** folds the dock to a single `◆ ▸` and remembers that across sessions.

Buttons work even while Claude is busy: a press writes a small signal that the target mod reacts to at once. A slash command would wait until the turn ends.

**Review everything at once:** `/mods-review` opens Mods, Plan, Coach and PRs together (as tabs), opens the next-task card, and unfolds the dock.

**The hub page:** click **Mods** in the dock, or type `/mods`. A pane opens with every mod, its version, a one-line summary, **Details** (this page) and **Turn off / Turn on**.

**How on/off works:** the switched-off mods are a list on this computer, `~/.claude/mods-data/mod-hub/off.json`. *Turn off* adds a mod to it and *Turn on* takes it out. Whenever a mod loads, the engine first asks the mods loaded before it (`plugin.register`), and the hub refuses any mod on the list, so none of its hooks, commands or tools run. The engine's log names each one: `refused by mod-hub: switched off in /mods`.
- The switch also saves the mod's `hooks/hooks.json` again, byte for byte. The new timestamp makes every session that watches the folder reload that mod at once (a session busy with a reply does it when the reply ends), and the reload asks the hub again. Any other session picks the change up when it starts.
- The switch covers every session on this computer. Nothing is deleted.
- **The hub must load first.** A mod can only be refused by mods that load before it, so `mod-hub` comes first in `CLAUDE_CODE_PLUGIN_DIRS`, and the install scripts put it there. If a switched-off mod loads ahead of the hub (older installs listed folders alphabetically), the hub says so in a toast: run the install script again.

**On/off and git:** switching changes no tracked file, so `git status` stays clean and on/off never travels through a commit or `git pull`: each computer keeps its own list. `claude plugin test` always runs a mod's real code, whether it's switched off or not.
- Older hubs switched a mod off by pointing its `hooks.json` at a stub (`hooks/off.tsx`). The hub moves any mod it finds like that onto the list and points `hooks.json` back at `register.tsx` by itself.
- Leftover `off.tsx` files are git-ignored and safe to delete.

**Cost:** none. No model calls. The T tab checks the app's pane layout every 5 seconds (a local call).

**Data saved:** `~/.claude/mods-data/mod-hub/off.json`, the mods switched off on this computer.

**Notes:** the hub can't switch itself off from the page. To remove it, delete or rename its folder. Without the hub nothing refuses the switched-off mods, so they all load.

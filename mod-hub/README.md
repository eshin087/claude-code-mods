# Mod Hub

**What it does:** one page listing every mod in your mods folder, what each does in detail, and an on/off switch.

**The dock:** one line just above the prompt, always in the same place:
```
✓ done 6m50s                                   ●[P] ●[N] [C] ●[PR] [M] ▾
```
- **Left:** the running task's progress and "now" line. When it finishes it reads `✓ done 6m53s` until your next prompt.
- **Tabs:** one bordered letter each. **P** plan · **N** next tasks · **C** coach · **PR** pull requests · **M** mods. A click opens that panel; a second click closes it. Clicking **N** with no suggestions yet asks for them.
- **Dot before a letter:**
  - green: that panel is open.
  - amber: something new (suggestions ready, a new coach tip, a PR failing or in conflict).
- **Hover a tab** to open a tall card above the dock, framed in that tab's color, without opening anything:
  - **P** (cyan): task, bar, %, step, time left, now, and the step checklist.
  - **N** (amber): the three suggestions with their reasons.
  - **C** (violet): cache and context bars, cost, habits, what to do next.
  - **PR** (green): each PR's state.
  - **M** (pink): every mod, on or off.
- **Keys** (terminal only): with the dock focused, p, n, c, r and m press the tabs. The desktop app shows a shortcut as a second letter badge, so the tabs there carry none.
- **▾** folds the dock to a single `◆ ▸` and remembers that across sessions.

Buttons work even while Claude is busy: a press writes a small signal that the target mod reacts to at once. A slash command would wait until the turn ends.

**Review everything at once:** `/mods-review` opens Mods, Plan, Coach and PRs together (as tabs), opens the next-task card, and unfolds the dock.

**The hub page:** click **Mods** in the dock, or type `/mods`. A pane opens with every mod, its version, a one-line summary, **Details** (this page) and **Turn off / Turn on**.

**How on/off works:** each mod's `hooks/hooks.json` names the code file that runs. *Turn off* points it at an empty stub (`hooks/off.tsx`) and *Turn on* points it back at `hooks/register.tsx`. Nothing is deleted. Sessions that watch the folder reload the mod at once; any other session picks the change up when it starts. The switch is shared by every session on this PC, because it changes the file itself.

**Cost:** none. No model calls.

**Data saved:** none of its own.

**Notes:** the hub can't switch itself off from the page. To remove it, delete or rename its folder.

# Testing the dock and mods

Two layers:
- **Automated tests:** run in Claude Code's plugin test runner, with a simulated app and clock. They check the logic.
- **Manual checklist:** the things only a real window can show, like whether the dock fits on one line at your width, how keys and focus behave in the desktop app, and where panels open.

Last run: **2026-10-08, Claude Code 2.1.286. 56 automated tests, 56 pass.**

## Running the automated tests

Each mod's tests live in its `tests/` folder and run against that mod alone. The other mods are played by small stand-ins, because a test may only load code from its own folder. Use the app's bundled engine, not an older `claude` on PATH:

```powershell
$claude = (Get-ChildItem "$env:APPDATA\Claude\claude-code" -Recurse -Filter claude.exe | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
foreach ($m in 'mod-hub','mission-control','coach','pr-desk','next-tasks','usage-meter') { & $claude plugin test "$env:USERPROFILE\Desktop\Claude Code\mods\$m" }
```

On/off doesn't affect the tests. The hub keeps its switches in `~/.claude/mods-data/mod-hub/off.json` and applies them when a real session loads the mods, so `claude plugin test` always runs a mod's own code, even one that's switched off.

| Mod | File | Tests |
|---|---|---|
| mod-hub | `tests/dock.test.tsx` | 15 (terminal buttons, desktop strip and popup, the engine's node never under a positioned Box, T, folding) |
| mod-hub | `tests/onoff.test.tsx` | 8 (turn off and on, a page that's behind, refused at load, moving old stub switches, load order, removed mod folders) |
| mission-control | `tests/progress.test.tsx` | 10 (progress, done chip, idle time, stale boards, estimate accuracy, the working row) |
| next-tasks | `tests/card.test.tsx` | 11 |
| coach | `tests/toggle.test.tsx` | 4 |
| pr-desk | `tests/toggle.test.tsx` | 1 |
| usage-meter | `tests/meter.test.tsx` | 7 |

## Checklist

✅ = automated and passing · 👀 = check by hand · ☐ = your tick box

### 1. Each dock button opens its panel and closes it on a second click

| | Check | How it's tested |
|---|---|---|
| ✅ | Tabs are single letters **P N C PR T M**: buttons on the terminal, one strip drawn by `tabs.tsx` on desktop | dock 1 (both) |
| ✅ | Amber dots before anything opens: suggestions ready, a new coach tip, a PR in conflict | dock 1 |
| ✅ | A click turns a tab's dot green while its panel is open; a second click clears it (all 6, terminal and desktop) | dock 1 (both) |
| ✅ | **T** opens the app's Background tasks pane and closes it; without the app's view tools, a toast says where to find it | dock 5, 5b |
| ✅ | Plan: a dock press opens the mission pane, a second press closes it, and the open flag follows | mission-control 1 |
| ✅ | Next: a press folds the card, another reopens it | next-tasks 1 |
| ✅ | Coach: a press opens and closes the pane; a press meant for another mod leaves it alone | coach 1, 1b |
| ✅ | PRs: a press opens the pane and loads the PR list; a second press closes it | pr-desk 1 |
| 👀 ☐ | In the real app each panel actually appears where you can see it. If one doesn't, a toast should say why. | manual |
| 👀 ☐ | Closing a panel with its own **Close** button or Esc also removes the `● ` from its dock button | manual |
| 👀 ☐ | Panels toggle while Claude is mid-task, without waiting for the reply to end | manual |

### 2. Keyboard shortcuts p, n, c, r, m after clicking the dock

| | Check | How it's tested |
|---|---|---|
| ✅ | Terminal: Plan=p, Next=n, Coach=c, PRs=r, Tasks=t, Mods=m. Desktop: no shortcuts (no second letter badge) | dock 1 (both) |
| 👀 ☐ | Click the dock, then each key presses its button | manual. The test kit can't press keys, and the desktop app may not support button shortcuts at all (see L1) |
| 👀 ☐ | Typing those letters in the prompt box (dock not clicked) only types them | manual |

### 3. The dock stays on one line; ▾ folds it, and it stays folded

| | Check | How it's tested |
|---|---|---|
| ✅ | Layout: the status side shrinks and cuts off with "…"; the buttons never shrink or wrap | dock 3a (structure only) |
| ✅ | ▾ leaves only `◆ ▸`: no status, no other buttons, no next-task card; `◆ ▸` brings everything back | dock 3b, next-tasks 3 |
| ✅ | Folding saves the choice; unfolding clears it | dock 3d |
| ✅ | A session that starts with the saved choice opens folded | dock 3c |
| 👀 ☐ | At your usual window width, with a long "now" line, the dock is one line | manual (the test kit doesn't lay text out) |
| 👀 ☐ | Fold, quit and reopen the app, then start a new session: it's still folded | manual |

### 4. Progress updates smoothly; the done chip appears and goes away

| | Check | How it's tested |
|---|---|---|
| ✅ | During a step the % rises every second by less than 1% and never goes backwards; elapsed time counts each second | mission-control 4a (30 simulated seconds) |
| ✅ | Finishing a step jumps the % to at least that step's share, and the step number and "now" line update | mission-control 4a |
| ✅ | Finishing the task shows `✓ done <time>` (100%, no time left) | mission-control 4b, dock 4a |
| ✅ | The chip stays through the end of the reply and while you're idle, then clears when you send your next prompt | mission-control 4b |
| ✅ | Time stops counting while Claude waits for you | mission-control 4c |
| ✅ | A task board Claude stops updating clears itself after 2 replies | mission-control 4d |
| 👀 ☐ | On a long real task the bar visibly creeps forward between steps | manual |
| ✅ | Desktop working row: the animated row module with the step dots, the step's name, time on task, time left and the "now" line, which types itself in | mission-control 5a |
| ✅ | It animates on its own frame clock: the spinner turns and the colors (glint, pulse) move every frame | mission-control 5b |
| ✅ | A step that runs past its share turns time left amber with *step running long* | mission-control 5c |
| ✅ | Terminal: the engine's own working line stays, its text rewritten with the progress | mission-control 5d |
| 👀 ☐ | In the app, the row draws in color and animates smoothly, stays on one line, and nothing reports "refused" | manual |
| ✅ | A finished task scores its time-left guesses (median miss); P shows *Past estimates: off by ~X%*, and the next task starts with it | mission-control 4e |

### 5. One hover card, the auto-hiding card, and the footer meter

| | Check | How it's tested |
|---|---|---|
| ✅ | Hovering any tab shows exactly one card, at the same spot for every tab, just above the dock row; the band grows to fit it only while it shows; leaving the strip removes it and shrinks the band back | dock 1b |
| ✅ | Each card's content: P (with accuracy), N, C (with limits and reset time), PR, T (running agents), M | dock 1b |
| 👀 ☐ | In the app, the card never clips at the top or the right, no line wraps, and the dock and tabs don't move while it shows (with and without the next-task card open) | manual |
| ✅ | The next-task card folds to N after 10 s with no answer; reopening gives a fresh 10 s | next-tasks auto-hide |
| ✅ | The footer meter is a plain SVG (an interactive one isn't drawn in the footer) | meter desktop |
| ✅ | A new session shows the last reading at once; a 5-hour window that has reset since is left out | meter restore tests |
| 👀 ☐ | The meter stays in the footer across new sessions and app restarts | manual |

### 6. On/off stays on this computer

| | Check | How it's tested |
|---|---|---|
| ✅ | **Turn off** adds the mod to `off.json` and saves its `hooks.json` again unchanged (no stub, nothing for git); **Turn on** takes it off the list | onoff 6a |
| ✅ | A button does what it said, even when another session changed the list after the page was drawn | onoff 6b |
| ✅ | A mod on the list is refused when it loads; mods not on it load as usual | onoff 6c, 6d |
| ✅ | A mod switched off the old way (`hooks.json` naming `off.tsx`) moves to the list, and its `hooks.json` goes back to `register.tsx` | onoff 6e |
| ✅ | A switched-off mod listed ahead of the hub gets a toast saying to run the install script again | onoff 6f |
| ✅ | A mod folder that's gone (deleted, or removed by a `git pull`) comes out of `CLAUDE_CODE_PLUGIN_DIRS` in `settings.json` (backed up first) and out of `off.json`, with a toast; folders elsewhere and every other setting are left alone, and nothing is written while all folders are there | onoff 6g, 6h |
| ✅ | In a running engine: switching off a loaded mod unloads it, switching it on loads it and runs its `session.start`, a hub reload leaves off mods off, and a mod listed before the hub can't be refused | checked 2026-10-04 in headless sessions of the bundled engine: stand-in mods, then all 9 real mods in an isolated copy (also an old stub switch, moved and refused at start, and the ahead-of-hub toast) |
| 👀 ☐ | Switch a mod off on the hub page: an open, idle session drops it within seconds, and `git status` shows nothing | manual |
| 👀 ☐ | Switch it back on: its tab or panel comes back without starting a new session | manual |

## Bug log

Found while writing and running these tests on 2026-10-03.

| # | Severity | Bug | Status | Covered by |
|---|---|---|---|---|
| B1 | High | **Open-panel highlight never showed.** The dock buttons are `plain`, and a plain Button ignores `variant="primary"`, so you could never tell which panels were open. | Fixed: an open panel's button reads `● Name` | dock 1 |
| B2 | High | **A button stayed "open" after its panel closed.** A mod's own `$.ui.close` doesn't reach its own close listener, so closing a panel from the dock or its **Close** button left the open flag on. Affected Mods, Plan, Coach and PRs. | Fixed: each toggle resets the flag itself, and Close buttons use the toggle | dock 1, mission-control 1, coach 1, pr-desk 1 |
| B3 | Medium | **Folding didn't hide everything.** The next-task card still drew above the folded `◆ ▸`. | Fixed: the folded dock drops other rows, and Next Tasks stays hidden while the dock is folded | dock 3b, next-tasks 3 |
| B4 | Medium | **A task board could get stuck.** If Claude never marked a task finished, the dock showed something like `◎ 83% 5/5` forever. | Fixed: cleared after 2 replies with no update | mission-control 4d |
| B5 | Medium | **This session didn't pick up edits.** It loads the mods through links to this folder, and it doesn't see changes made inside linked folders. The dock and braille meter never loaded here, which is why the bottom meter looked unchanged. Sessions started after the install load the folder directly and aren't affected. | Fixed for this session by re-creating the links (reloads when the reply ends) | manual |
| B6 | Low | **Double toggle risk.** If two dock writes collided, the retried write could open a panel and close it again. | Fixed: mods act only on a write that landed | not testable (a timing race) |
| B7 | Low | **The dock could wrap at narrow widths.** Nothing stopped the buttons from shrinking. | Fixed: the status side shrinks and cuts off, the buttons keep their size | dock 3a (structure); real width is manual |
| B9 | High | **The hover cards would have blanked the whole dock.** Each card carried its own `key`, which makes it a hover target of its own; a hidden keyed box can never be hovered, so the engine refused the dock and drew nothing. | Fixed: the visible tab box is the hover target | dock 1b |
| B10 | High | **The Coach mod failed to load.** A local name reused a top-level helper's name, and the engine refuses such a module. | Fixed: renamed | coach tests (all 4) |
| B11 | High | **The N tab showed nothing.** A reload cut off the suggestion request mid-flight and left its card stuck on "loading" forever. | Fixed: a card still loading when the mod loads is cleared; clicking N with nothing asks for suggestions | next-tasks (orphaned card, click N) |
| B12 | Medium | **Each dock letter showed twice on desktop** (`P P`). The desktop draws a button's shortcut as a key badge beside its label. | Fixed: shortcuts on the terminal only | dock 2 |
| B13 | Medium | **Hover cards and footer bars were clipped.** The hover card drew above its area and got cut off; the footer slot fits only ~20 characters. | Fixed: cards are revealed inside the area above the prompt, so it grows to fit; the footer uses short bars, with the full meter in a hover card | dock 1b, meter tests |
| B14 | High | **Hover cards didn't show on desktop.** They were revealed through a hover group from another spot in the band, which the desktop app doesn't support. | Fixed: each card lives inside its letter's own box (which the desktop does hover), with a hidden spacer that reserves the card's height so nothing clips | dock 1b; hover itself is manual |
| B15 | Medium | **Next-task rows showed their number twice on desktop** (the label's number plus a shortcut badge). | Fixed: no shortcut badge on desktop | next-tasks layout test |
| B16 | Medium | **Footer bars looked broken up.** Bar characters left visible gaps, and the slot clipped long text. | Fixed: on desktop the footer is one 145 px SVG with solid rounded bars and a tooltip; text bars on the terminal | meter tests |
| B17 | Medium | **Dock progress was cut off.** The bar, step and time shared one shrinking text with the "now" line, so the numbers were trimmed first. | Fixed: the solid bar, %, step and time never shrink; only the "now" text is trimmed | dock 3a |
| B18 | Low | **Hover cards grew the whole dock.** The card's reserved space made the dock look like a big window. | Fixed: the card floats above the letter as a popup and the dock stays one line | dock 1b |
| B19 | High | **Two hover cards at once, clipped, in a different spot per tab.** Each tab had its own popup, and the desktop ignores `right: 0` on absolute boxes, so each card sat where its letter was. | Fixed: the dock draws a single card at a fixed left (dock width − card width), fed by a tab strip that reports which tab the pointer is over | dock 1b |
| B20 | High | **The footer meter came and went.** The interactive (framed) SVG isn't drawn in the footer slot, and a new session had no reading until its first reply. | Fixed: a plain SVG, and the last reading is saved and shown at start (minus windows that have reset) | meter tests |
| B21 | High | **The new tab strip didn't load.** The engine finds a strip's code by reading the source for a `Client` element with a literal path; the variable was named `ClientEl`, so it found none. | Fixed: named `Client` | dock 1, 1b |
| B22 | Medium | **Whole test suites failed for no code reason.** Next tasks, PR Desk and Plan autopilot were switched off in the hub, so the test runner loaded their empty stubs. | Fixed (2026-10-04): switches live in `mods-data/mod-hub/off.json` and the hub applies them at load, so tests always run the real code | all next-tasks and pr-desk tests, run while switched off |
| B23 | Medium | **On/off leaked into git.** A switch rewrote the tracked `hooks.json`, so it showed in `git status`, and committing it would switch that mod off on every computer. | Fixed with B22: a switch changes no tracked file; old stub switches are moved to the list by themselves | onoff 6a, 6e |
| B24 | High | **Hover card clipped at the top.** The band clips absolute boxes to itself, and it was only as tall as its content (the next-task card and the dock row), so a card placed above the dock lost its title and first lines. | Fixed: the card sits just above the dock row, and the band grows to fit it only while hovering (extra rows at the top, so the dock doesn't move); a short band cuts the card's lines | dock 1b |
| B25 | High | **The dock vanished from every chat** (B24's fix). The outer Box got `position` while holding the engine's own node for the band, which the engine refuses: "ui.render (AbovePrompt) refused: engine node under a Box with prop \"position\"; the engine drew its own". The test kit draws a plain Box there, so no test saw it. | Fixed: no Box above the engine's node has `position`; the card is placed from inside the dock row, which holds no engine node | dock 1c (both surfaces) |
| B8 | Low | **Old suggestions lingered.** `Next·3` stayed in the dock forever after a long turn. | Fixed: suggestions expire after 3 of your prompts | next-tasks "3 prompts later" |

### Known limits (not bugs, but worth knowing)

- **L1, shortcut keys:** terminal only, and only while the dock holds the keyboard (click it first). The desktop tabs have none.
- **L2, where panels open:** a dock press reaches the panel's mod as a signal. Whether the desktop app treats that as your click when deciding where to place the panel is unconfirmed. If a panel can't open, its mod shows a toast with the reason.
- **L3, fully hiding the dock:** ▾ leaves a one-character `◆ ▸` so you have something to click to unfold. Hiding it completely would need another way back, such as a `/dock` command (not built yet).
- **L4, progress within a step:** the % inside a step is an estimate based on time, and stops at 90% of that step until Claude marks it done.
- **L6, the T tab:** it drives the desktop app's own pane through the app's view tools. If a mod can't reach them (an older app, or the terminal), T shows a toast pointing to the menu instead.
- **L7, estimate accuracy:** it appears only after a task that showed time-left guesses finishes with `finished: true`. A board cleared as stale isn't scored.
- **L8, load order:** the hub can only keep off mods that load after it, so `mod-hub` must be first in `CLAUDE_CODE_PLUGIN_DIRS`. The install scripts do this; otherwise the hub shows a toast.
- **L5, test shortcuts:** the stand-in mods replay the real mods' signal handling, and each real mod's own handling is tested in its own folder. Two of the mod tests fake a dock click with a prompt flagged as coming from a mod, because the test kit has no click into another mod's code.

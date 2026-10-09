# Testing the dock and mods

Two layers:
- **Automated tests:** run in Claude Code's plugin test runner, with a simulated app and clock. They check the logic.
- **Manual checklist:** the things only a real window can show, like whether the dock fits on one line at your width, how keys and focus behave in the desktop app, and where panels open.

Last run: **2026-10-08, Claude Code 2.1.293 (the desktop app's engine since 2026-10-07). 54 automated tests, 54 pass.**

## Running the automated tests

Each mod's tests live in its `tests/` folder and run against that mod alone. The other mods are played by small stand-ins, because a test may only load code from its own folder. Use the app's bundled engine, not an older `claude` on PATH:

```powershell
# The engine the app runs: set inside a Claude Code session; otherwise the newest one installed.
$claude = $env:CLAUDE_CODE_EXECPATH
if (-not $claude) { $claude = (Get-ChildItem "$env:LOCALAPPDATA\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code", "$env:APPDATA\Claude\claude-code" -Recurse -Filter claude.exe -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1).FullName }
foreach ($m in 'mod-hub','mission-control','coach','pr-desk','next-tasks','usage-meter') { & $claude plugin test "$env:USERPROFILE\Desktop\Claude Code\mods\$m" }
```

On/off doesn't affect the tests. The hub keeps its switches in `~/.claude/mods-data/mod-hub/off.json` and applies them when a real session loads the mods, so `claude plugin test` always runs a mod's own code, even one that's switched off.

| Mod | File | Tests |
|---|---|---|
| mod-hub | `tests/dock.test.tsx` | 8 (the slim line idle, working, done and with no plan; the engine's node never under a Box the engine refuses it under; /mods) |
| mod-hub | `tests/onoff.test.tsx` | 8 (turn off and on, a page that's behind, refused at load, moving old stub switches, load order, removed mod folders) |
| mission-control | `tests/progress.test.tsx` | 15 (progress, done chip, idle time, stale boards, estimate accuracy, the working row and its plan link, restated and odd-shaped plans) |
| next-tasks | `tests/card.test.tsx` | 10 (opens after a long turn, stays, cleared by your next prompt, stale answers dropped, /next) |
| coach | `tests/toggle.test.tsx` | 4 |
| pr-desk | `tests/toggle.test.tsx` | 1 |
| usage-meter | `tests/meter.test.tsx` | 8 |

## Checklist

✅ = automated and passing · 👀 = check by hand · ☐ = your tick box

### 1. Panels open from their slash commands

| | Check | How it's tested |
|---|---|---|
| ✅ | `/mods` opens the Mods page; again closes it | dock 7 |
| ✅ | Plan, Coach and PRs: a press for the mod (the `signal` /mods-review uses) toggles its pane, and the open flag follows | mission-control 1, coach 1, 1b, pr-desk 1 |
| 👀 ☐ | In the app, `/mission`, `/coach`, `/prs`, `/next` and `/mods` each open their panel where you can see it. If one can't open, a toast says why | manual |
| 👀 ☐ | `/mods-review` opens Mods, Plan, Coach and PRs at once | manual |

### 2. The dock: one slim line, only when there's something to say

| | Check | How it's tested |
|---|---|---|
| ✅ | Idle with a plan under way: the bar, %, step and time left, then the "now" line; no tabs, buttons, cards or fold | dock 1 (both surfaces) |
| ✅ | While Claude works the dock adds nothing: the working row carries the progress | dock 3 |
| ✅ | A finished plan shows `✓ done <time>`, also while the next turn starts | dock 4 |
| ✅ | No plan, or a board with no steps: nothing above the prompt but the engine's own | dock 5 |
| ✅ | The engine's own node is never under a Box the engine refuses it under (display, overflow, position, a size, an offset) | dock 2 (both surfaces) |
| 👀 ☐ | In the app: no tab letters or hover cards, and the dark panel above the prompt never grows | manual |
| 👀 ☐ | At your usual window width, with a long "now" line, the dock is one line | manual (the test kit doesn't lay text out) |

### 3. Progress updates smoothly; the done chip appears and goes away

| | Check | How it's tested |
|---|---|---|
| ✅ | During a step the % rises every second by less than 1% and never goes backwards; elapsed time counts each second | mission-control 4a (30 simulated seconds) |
| ✅ | Finishing a step jumps the % to at least that step's share, and the step number and "now" line update | mission-control 4a |
| ✅ | Finishing the task shows `✓ done <time>` (100%, no time left) | mission-control 4b, dock 4 |
| ✅ | The chip stays through the end of the reply and while you're idle, then clears when you send your next prompt | mission-control 4b |
| ✅ | Time stops counting while Claude waits for you | mission-control 4c |
| ✅ | A task board Claude stops updating clears itself after 2 replies | mission-control 4d |
| 👀 ☐ | On a long real task the bar visibly creeps forward between steps | manual |
| ✅ | Desktop working row: the animated row module with %, a 6-cell bar, the step number, time on task, time left and a **plan ›** link; no summary text | mission-control 5a |
| ✅ | It animates on its own frame clock: the spinner turns and the colors (glint, pulse) move every frame | mission-control 5b |
| ✅ | A step that runs past its share turns time left amber with *step running long* | mission-control 5c |
| ✅ | A click on the row opens the Mission pane (the link then reads *hide plan*); another closes it | mission-control 5d |
| ✅ | Terminal: the engine's own working line stays, its text rewritten with the progress | mission-control 5e |
| ✅ | While a turn runs, the dock leaves the progress to the working row; idle, it shows the progress | dock 1, 3 |
| 👀 ☐ | In the app, the row draws in color and animates smoothly, stays on one line, and nothing reports "refused" | manual |
| ✅ | A finished task scores its time-left guesses (median miss); the Mission pane shows *Past estimates here: off by ~X%*, and the next task starts with it | mission-control 4e |

### 4. Next-task suggestions and the footer meter

| | Check | How it's tested |
|---|---|---|
| ✅ | The suggestions stay with no answer (no auto-hide); a task, ✕ or your next prompt clears them | next-tasks: stays, next prompt, ✕, a bordered number |
| ✅ | Suggestions still on their way when you send a prompt are dropped: they were for the turn before | next-tasks: dropped |
| ✅ | `/next` asks over the whole conversation and opens the card | next-tasks: /next |
| ✅ | The footer meter is `5h 38% · wk 18%`: grey labels, each % green, amber or red by how full it is; text, no picture, no purple | meter desktop, colors |
| ✅ | The terminal adds the 5-hour reset time | meter terminal |
| 👀 ☐ | On the desktop both windows show in full, right of the prompt footer, near the model picker | manual (B28, B31) |
| ✅ | A new session shows the last reading at once; a 5-hour window that has reset since is left out | meter restore tests |
| 👀 ☐ | The meter stays in the footer across new sessions and app restarts | manual |

### 5. On/off stays on this computer

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
| 👀 ☐ | Switch it back on: it works again without starting a new session | manual |

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
| B26 | High | **The working row showed `0% · 0/0 · ~1m left`, and its plan link opened an empty plan.** Claude often updates the board by re-sending the whole list, each step as `{ title, status }`; the tool read only `text`, so it dropped every step and replaced the running plan with an empty one (15 times in real chats, 2026-10-04 to 10-08). | Fixed: steps are read from `text`, `title`, `name` or plain strings, with their `status`; the same title (or any status) restates the running plan and keeps its clock; a list with nothing readable changes nothing; a board with no steps draws no row | mission-control 6a-6d |
| B27 | High | **The dock and next-task card disappeared from chats, "randomly".** On engine 2.1.293 the engine also refuses its node under a Box with `minHeight` (and display, overflow, a size or an offset). The band got `minHeight` while a hover card showed, so hovering a tab took the whole band away, and with it the strip that would end the hover: it stayed gone until the next prompt. | Fixed: no such prop above the engine's node; a spacer row the card covers makes the room instead | dock 1b, 1c (both surfaces) |
| B28 | High | **The footer usage meter disappeared** after the desktop app updated to 2.26454 (engine 2.1.293). The app still asks for the footer slot (checked with a probe) but shows no picture there, and the meter had cleared its fallback line once asked. | Fixed: the meter is text on every surface; seen in the app 2026-10-08 | meter desktop |
| B29 | Low | **A next-tasks test failed on 2.1.293.** Its stand-in answered `prompt.fill` with the old `{ value: { isFilled } }` shape; the mod itself already read the new `{ isFilled }`. | Fixed: the test answers in the new shape | next-tasks "pressing a bordered number" |
| B30 | Medium | **Hovering a dock tab made the panel above the prompt grow.** The engine can only draw a card inside the band, so a hover card grew the app's dark panel around the dock instead of floating on its own; the engine has no floating window or tooltip. | Removed: no tabs and no hover cards; the dock is one slim line, and panels open with their slash commands | dock 1, 5 |
| B31 | Medium | **The weekly % was cut off in the footer** (`5h ━━── 45% W ━ ──…`). The bars made the meter wider than the desktop's footer slot. | Fixed: numbers only, `5h 45% · wk 24%` | meter desktop |
| B8 | Low | **Old suggestions lingered.** `Next·3` stayed in the dock forever after a long turn. | Fixed: suggestions expire after 3 of your prompts | next-tasks "3 prompts later" |

### Known limits (not bugs, but worth knowing)

- **L2, where panels open:** /mods-review reaches each panel's mod as a signal. Whether the desktop app treats that as your click when deciding where to place the panel is unconfirmed. If a panel can't open, its mod shows a toast with the reason.
- **L4, progress within a step:** the % inside a step is an estimate based on time, and stops at 90% of that step until Claude marks it done.
- **L7, estimate accuracy:** it appears only after a task that showed time-left guesses finishes with `finished: true`. A board cleared as stale isn't scored.
- **L8, load order:** the hub can only keep off mods that load after it, so `mod-hub` must be first in `CLAUDE_CODE_PLUGIN_DIRS`. The install scripts do this; otherwise the hub shows a toast.
- **L5, test shortcuts:** the stand-in mods replay the real mods' signal handling, and each real mod's own handling is tested in its own folder. Two of the mod tests fake a press with a prompt flagged as coming from a mod, because the test kit has no click into another mod's code.

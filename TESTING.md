# Testing the dock and mods

Two layers:
- **Automated tests:** run in Claude Code's plugin test runner, with a simulated app and clock. They check the logic.
- **Manual checklist:** the things only a real window can show, like whether the dock fits on one line at your width, how keys and focus behave in the desktop app, and where panels open.

Last run: **2026-10-03, Claude Code 2.1.286. 37 automated tests, 37 pass.**

## Running the automated tests

Each mod's tests live in its `tests/` folder and run against that mod alone. The other mods are played by small stand-ins, because a test may only load code from its own folder. Use the app's bundled engine, not an older `claude` on PATH:

```powershell
$claude = (Get-ChildItem "$env:APPDATA\Claude\claude-code" -Recurse -Filter claude.exe | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
foreach ($m in 'mod-hub','mission-control','coach','pr-desk','next-tasks','usage-meter') { & $claude plugin test "$env:USERPROFILE\Desktop\Claude Code\mods\$m" }
```

| Mod | File | Tests |
|---|---|---|
| mod-hub | `tests/dock.test.tsx` | 14 (most run on both terminal and desktop) |
| mission-control | `tests/progress.test.tsx` | 5 |
| next-tasks | `tests/card.test.tsx` | 9 |
| coach | `tests/toggle.test.tsx` | 4 |
| pr-desk | `tests/toggle.test.tsx` | 1 |
| usage-meter | `tests/meter.test.tsx` | 4 |

## Checklist

✅ = automated and passing · 👀 = check by hand · ☐ = your tick box

### 1. Each dock button opens its panel and closes it on a second click

| | Check | How it's tested |
|---|---|---|
| ✅ | Badges before anything opens: `Plan`, `Next·3`, `Coach•`, `PRs 2✗`, `Mods` | dock 1 |
| ✅ | Each button's label gains `● ` while its panel is open and loses it on the second click (all 5, terminal and desktop) | dock 1 |
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
| ✅ | Plan=p, Next=n, Coach=c, PRs=r, Mods=m, each unique (terminal and desktop) | dock 2 |
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
| 👀 ☐ | On a long real task the braille bar visibly creeps forward between steps | manual |

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
| B8 | Low | **Old suggestions lingered.** `Next·3` stayed in the dock forever after a long turn. | Fixed: suggestions expire after 3 of your prompts | next-tasks "3 prompts later" |

### Known limits (not bugs, but worth knowing)

- **L1, shortcut keys:** they work only while the dock holds the keyboard (click it first). The desktop app may not support button shortcuts at all. The tests only confirm each button declares a unique key.
- **L2, where panels open:** a dock press reaches the panel's mod as a signal. Whether the desktop app treats that as your click when deciding where to place the panel is unconfirmed. If a panel can't open, its mod shows a toast with the reason.
- **L3, fully hiding the dock:** ▾ leaves a one-character `◆ ▸` so you have something to click to unfold. Hiding it completely would need another way back, such as a `/dock` command (not built yet).
- **L4, progress within a step:** the % inside a step is an estimate based on time, and stops at 90% of that step until Claude marks it done.
- **L5, test shortcuts:** the stand-in mods replay the real mods' signal handling, and each real mod's own handling is tested in its own folder. Two of the mod tests fake a dock click with a prompt flagged as coming from a mod, because the test kit has no click into another mod's code.

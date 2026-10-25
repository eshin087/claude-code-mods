# Testing the mods

Two layers:
- **Automated tests:** run in Claude Code's plugin test runner, with a simulated engine, clock, files and network. They check the logic.
- **Manual checklist:** what only the real app can show, like how the footer looks at your window size.

Last run: **2026-10-15, Claude Code 2.1.299. 56 automated tests, 56 pass.**

## Running the automated tests

Each mod's tests live in its `tests/` folder. Use the engine the app runs, not an older `claude` on PATH:

```powershell
# The engine the app runs: set inside a Claude Code session; otherwise the newest one installed.
$claude = $env:CLAUDE_CODE_EXECPATH
if (-not $claude) { $claude = (Get-ChildItem "$env:LOCALAPPDATA\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code", "$env:APPDATA\Claude\claude-code" -Recurse -Filter claude.exe -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1).FullName }
foreach ($m in 'hub','askfirst','inbox','limits','pace','timings') { & $claude plugin test "$env:USERPROFILE\Desktop\Claude Code\mods\$m" }
```

| Mod | File | Tests |
|---|---|---|
| hub | `tests/hub.test.tsx` | 7 (/mods page, details, turn off and on, a page that's behind, refused at load, the rest load, load order) |
| limits | `tests/limits.test.tsx` | 13 (the endpoint and your login, colors, the 5-hour countdown (none for the weekly window), the same line on the desktop, sharing one reading, headers between checks, failures and back-off, no login, a reset passing) |
| timings | `tests/timings.test.tsx` | 6 (a prompt's record, its row in the chat, its footer button, the pane and totals, a restarted chat, past chats) |
| inbox | `tests/inbox.test.tsx` | 13 (each state and what clears it, one notification per change, the pane's groups and order across chats, nothing in the footer, stale and broken records ignored) |
| askfirst | `tests/askfirst.test.tsx` | 7 (the instruction only while on, /askfirst on/off/toggle, the footer label, kept across chats) |
| pace | `tests/pace.test.tsx` | 10 (running out before the reset and the one warning, too little history, not rising, this chat's tally and working time, /pace, no readings, no pace button on the desktop, 🔹P and P! in the terminal, no false alarm right after a reset) |

## Checklist

✅ = automated and passing · 👀 = check by hand · ☐ = your tick box

### 1. The /mods page (hub)

| | Check | How it's tested |
|---|---|---|
| ✅ | `/mods` lists every mod, on or off, with its version and description; again closes it | hub: /mods |
| ✅ | **Details** shows the mod's README; **Hide details** folds it | hub: details |
| ✅ | **Turn off** adds the mod to `off.json` and saves its `hooks.json` again unchanged (nothing for git); **Turn on** takes it off | hub: turn off and on |
| ✅ | A button does what it said, even when another session changed the list | hub: page behind |
| ✅ | A switched-off mod is refused when it loads; the others load | hub: refused, load |
| ✅ | A switched-off mod listed ahead of the hub gets a toast to run the install script | hub: load order |
| 👀 ☐ | Switch a mod off on the page: an open, idle chat drops it within seconds | manual |

### 2. The footer meter (limits)

| | Check | How it's tested |
|---|---|---|
| ✅ | Reads the usage endpoint with your login, and shows `5h 22% 3h27 · w 76%` | limits: endpoint |
| ✅ | The words 5h and w and the dot between the windows dim grey, the numbers bright with the % bold | limits: endpoint |
| ✅ | A % from 85% up and a countdown under 30 minutes turn red | limits: turn red |
| ✅ | The 5-hour countdown is green past 3 hours, orange from 1 to 3 hours, red under 1 hour | limits: 5-hour shades |
| ✅ | The 5-hour window's time left to its reset in hours and minutes; the weekly window shows none | limits: endpoint |
| ✅ | One line of text, the same on the desktop and the terminal | limits: same line, endpoint |
| ✅ | One reading shared by every session; a reply's headers update it for free; a failure waits 10 minutes and says why in the file | limits: shared, headers, fails |
| ✅ | No login (an API key, another provider): nothing asked, nothing drawn | limits: no login |
| 👀 ☐ | On the desktop the whole line shows right of the prompt, by the model picker, not cut off | manual |
| 👀 ☐ | The numbers match the app's usage button | manual |

### 3. The pace panel (pace)

| | Check | How it's tested |
|---|---|---|
| ✅ | A table per window: bar and %, time left to the reset, pace (5-hour over the last hour, weekly over the last day), and *runs out ~X, before the reset* or *lasts until the reset* | pace: runs out |
| ✅ | One warning toast per window, across all chats | pace: runs out |
| ✅ | *not enough history yet* and *not rising* instead of a guess | pace: history, not rising |
| ✅ | This chat's tokens (subagents' too), cost, turns, and how far each window rose; a new window starts the count over | pace: tally |
| ✅ | `/pace` and, in the terminal, the footer's `🔹P` open and close the panel; the desktop footer has no pace button | pace: /pace, terminal P, desktop |
| ✅ | **P!** in the terminal while the pace would run a limit out before it resets | pace: warns |
| ✅ | No projection, warning or P! from too little history (a point of rise right after a reset) | pace: no false alarm |
| 👀 ☐ | In the app, P shows after the limits and a click toggles the panel | manual |
| 👀 ☐ | After a busy hour the panel's pace looks right against the usage button | manual |

### 4. Prompt timings (timings)

| | Check | How it's tested |
|---|---|---|
| ✅ | A finished prompt is kept with its time, tokens (subagents' too) and cost, in this chat's file | timings: record |
| ✅ | Its row in the chat gets `⏱ 3m 12s · 1.2M tokens · $0.84` under it; other rows stay as they are | timings: row |
| ✅ | The footer's `🔸` button opens and closes the pane on a press (or `/timings`) | timings: footer |
| ✅ | The pane: each prompt's time, tokens and cost; a Total row with each total under its column; then chat open, the token split and the cost | timings: pane |
| ✅ | A restarted chat keeps its history; **Past chats** lists the project's chats with totals | timings: restarted, past chats |
| 👀 ☐ | In the app, the line shows under each finished prompt as you scroll, and T shows after P | manual |

### 5. Waiting on you (inbox)

| | | |
|---|---|---|
| ✅ | A chat is marked needing approval, a question, your turn, working or idle, and back as things move on | inbox: states |
| ✅ | One notification when a chat starts needing approval or an answer, or finishes a reply of 2 minutes or more | inbox: notify |
| ✅ | `/inbox` opens a pane: Needs you (oldest first), Your turn, then how many are working | inbox: pane, footer |
| 👀 ☐ | On desktop, a permission prompt in one chat shows up in another chat's `/inbox` within about 5 seconds | manual |
| 👀 ☐ | On desktop, the notification actually appears (see L7) | manual |

### 6. Ask first (askfirst)

| | | |
|---|---|---|
| ✅ | `/askfirst` switches the instruction on and off for every chat; the footer says "ask first" while on | askfirst |
| 👀 ☐ | With ask-first on, Claude asks its questions before a non-trivial task | manual |

## Known limits

- **L1, the footer:** the desktop fits about 20 characters of text in its footer slot, after any buttons, and cuts the rest with "…", so the limits line is kept short. It shows no picture or interactive meter; the details live in `/pace`.
- **L2, "while this chat ran":** the rise in each window is counted between this chat's own replies. The account's windows are shared, so another chat working at the same time adds to it.
- **L4, hover:** the desktop app draws a Box hidden until a hover in another spot (`hover.scope`) all the time, so pace has no hover summary above the prompt; the panel carries the details.
- **L3, the usage endpoint:** it's the one the app's usage button reads. If it changes, the meter falls back to each reply's own headers, and the file's `error` says why.
- **L5, no jump to a prompt:** the engine scrolls the chat for a mod only in the terminal. The desktop and mobile apps' link to the engine carries scrolls of a mod's own panes and band, not of the chat, so the engine refuses there ("transcript not scrollable here"). Timings therefore has no click-to-jump.
- **L6, footer buttons on the desktop:** the app draws a button's label in one color of its own, so only an emoji keeps a color (🔸, 🔹). Text beside buttons is drawn after them in what's left of the slot.

The first set of mods, and their bug log, are in the git history before this version.
- **L7, notifications on desktop:** the engine's docs say a mod's OS notification may do nothing where the session has no terminal of its own, which is how the desktop app runs chats. If inbox's notifications don't appear, `/inbox` still works.
- **L8, inbox approvals:** an approval stays marked until the approved tool finishes, not when you approve it, since nothing tells a mod the moment it's approved. A closed chat's small record file stays (mods can't delete files) and is shown as idle, so it's hidden.

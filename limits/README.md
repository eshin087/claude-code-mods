# Limits

**What it does:** keeps your 5-hour and weekly limits in the footer next to the model picker, with the time left until each resets, so you never need the usage button.

**Where you see it:** the footer, right of the prompt:
```
5h 22%  3h27  ·  w 76%
```
- **5h** is the 5-hour window and **w** the weekly one (all models). The words and the dot between the windows are dim grey, the numbers bright (the % bold). **Red** marks trouble: a % from 85% up, and the 5-hour countdown under 1 hour. The **5-hour countdown shades with the time left**: green past 3 hours, orange from 1 to 3 hours, red under 1 hour.
- **3h27** after the 5h % is how long until that window resets (hours and minutes, no trailing m past an hour; `45m` under an hour). The weekly window shows no countdown here, to keep the line short; the [pace](../pace/README.md) panel has its reset.
- It's the same line on the desktop and the terminal; the desktop's footer slot is narrow, so the countdown is kept short and only the 5-hour window has one. The [timings](../timings/README.md) mod's **🔸** button follows it on both, and the [pace](../pace/README.md) mod's **🔹P** in the terminal. Footer text can't be clicked on the desktop, only buttons, and a button's text can't take color, so open the pace panel with `/pace` there.
- The desktop app didn't show a picture or an interactive meter in that slot. For the details, type `/pace` (the [pace](../pace/README.md) mod).

**Where the numbers come from:**
- The account endpoint the usage button reads, with your login. The engine attaches the login; the mod never sees it.
- Each reply's own rate-limit headers, in between, which cost nothing.
- Every open session shares one reading in `~/.claude/mods-data/limits/readings.json`, so only one session asks the endpoint at a time, at most every 3 minutes. If the endpoint fails, the file says why (`error`) and the mod waits 10 minutes before asking again.
- The same file keeps 8 days of readings, which the pace mod works from.

**Not shown:** the Fable weekly limit (the usage panel's per-model line).

**Cost:** no model calls. One small request to the usage endpoint every few minutes, shared by all your sessions.

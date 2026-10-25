# Pace

**What it does:** shows what this chat has used, and when your 5-hour and weekly limits run out if you keep going at your current pace.

**Where you see it:**
- **Open it with `/pace`** on the desktop: its footer slot is narrow and the limits and the timings button use it.
- **In the terminal**, where there is room, a **🔹P** button follows the limits line: a click opens the panel, another closes it.
- **In the terminal**, where there's room, a **🔹P** button follows the limits line: a click opens the panel, another closes it.
- **🔹P!** in the terminal instead of P while the pace would run a limit out before it resets. On the desktop, the toast warns.
- No hover summary: the desktop app can't show something above the prompt only while the pointer is on P (it drew it all the time), so the details are in the panel.

The panel:
```
Pace  updated 7:43p                                              Close

Window   Used              Resets in  Pace      At this pace
5-hour   ██████░░░░  64%   2h13m      +24%/h    runs out ~9:13p, before the reset
Weekly   ███████░░░  76%   1d 4h      +6%/day   lasts until the reset

This chat
Tokens   10k fresh · 1.2M cached · 30k out
Cost     $3.40 at API prices · 14 turns
Worked   1h42m over 12 prompts · each one in /timings
Used     5-hour +9% · weekly +2%
```
- **The table:** one row per window. The bar and % turn amber from 60% and red from 85%. *Resets in* is the time left. *At this pace* is amber when the window would run out before it resets, green when it lasts.
- **This chat:** labels on the left, values beside them (*Worked* comes from the [timings](../timings/README.md) mod's file for this chat, and is left out without it): tokens over every reply, subagents' included (fresh input, cached input, output), the cost as `/cost` counts it, and your turns. The rise in each window is counted between this chat's replies, so another chat working at the same time adds to it.
- **At this pace:** the 5-hour pace is the last hour's and the weekly pace the last day's, so a burst or a pause shows quickly. It says *not enough history yet* until the window has 20 minutes (5-hour) or 6 hours (weekly) of readings, so a point or two right after a reset isn't taken for a pace, and *not rising* when the window hasn't moved.
- **Warning:** when the pace would run a limit out at least 5 minutes before it resets, a toast says when, once per window across all your chats.

**Where the numbers come from:** the readings the limits mod keeps in `~/.claude/mods-data/limits/readings.json`, plus this chat's own replies. Without the limits mod the panel has no history to work from. The windows already warned about are in `~/.claude/mods-data/pace/warned.json`.

**Cost:** no model calls.

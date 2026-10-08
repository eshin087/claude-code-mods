# Mission Control

**What it does:** a live progress view for long tasks: the plan, % done, time elapsed, time left, and one line on what Claude is doing right now. It replaces scrolling through verbose updates.

**Where you see it:**
- **The dock** (Mod Hub's line above the prompt): `◎ 64% ⣿⣿⣿⣿⣷⣀⣀ 3/5 ~8m — <now>` while working, then `✓ done 6m53s` until your next prompt.
- **The "Working…" row** while Claude works. On the desktop it's an animated, colored line drawn by `hooks/row.tsx` on its own frame clock:
  ```
  ⠹ 37% ━━━━━━ 2/4 · 4m 33s · ~12m left  ✻ Paper trading needs its own key, so I should check the sandbox…
  ```
  - a spinner that cycles from cyan to violet, the % done, and a short bar shaded cyan to violet with a glint sweeping through it (the cell being filled pulses);
  - the step number, time on the task, and time left: green on pace, amber with *step running long* once the current step has run past its share, grey while it's a rough guess;
  - one line on what's going on, most telling first: while Claude thinks, its **latest thought** (`✻`, violet italics), live from the stream, the sentence it's on or the one it just finished; otherwise its **"now" line** (`›`), typed in each time it changes; otherwise what the app says the step is doing (`Creating notes.md`); otherwise the step's name. It's one line that ends in "…" when space runs out; it never wraps.

  The app adds its own tokens and mode after it. On the terminal the row keeps the engine's own animation, with its text rewritten: `37% · step 2/4 · 4m 33s · ~12m left — <thought or now>`.
- **Plan** in the dock (or `/mission`) toggles a pane with the checklist (✓ done with time taken, ▶ current, ○ to do) and a **Trail**: the last "now" lines with timestamps, a condensed history of the work.

**How it works:** the mod gives Claude a tool, `mcp__mission-control__plan`. For tasks with 3+ steps or over ~2 minutes, Claude posts a plan (3-8 steps, each sized 1-3), then updates it as steps start and finish. The mod does the maths:
- **% done** = finished step sizes + partial credit for the current step.
- **Time left** = remaining size × pace. Pace comes from this task's finished steps, blended with your earlier tasks in the same project.
- Shown as **≈** ("rough") until a step finishes or history exists.
- Only active time counts. Time waiting for you between turns does not.

**How accurate is it?** Every time the board shows a time left, the mod notes it. When the task finishes, it compares each guess with the time that was actually left and keeps the median miss (a guess of 4m when 2m were left is 100% off; a 1-minute floor stops the last few seconds from skewing it). **P** then shows *Past estimates: off by ~X% on average (N tasks)*, averaged over the project's last 20 tasks. Expect early guesses to be off by 2-3×; they tighten once a step or two finishes, and as the project builds up history.

**Thoughts:** the row reads Claude's thinking as it streams (the same text the app shows you live), passes every piece on unchanged, and keeps only the latest sentence, in memory, for this turn. Nothing is saved.

**Cost:** a short hidden reminder (~60 tokens) is attached to each prompt you send, plus a few small tool calls per task. No extra model calls.

**Data saved:** `~/.claude/mods-data/mission-control/<session>.json`: finished tasks' size, duration and estimate miss, used to calibrate future estimates and to score them.

**Limits:** the estimate is only as good as the plan. If scope grows, Claude adds steps and the % drops. It's an estimate, not a promise.

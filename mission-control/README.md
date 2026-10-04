# Mission Control

**What it does:** a live progress view for long tasks: the plan, % done, time elapsed, time left, and one line on what Claude is doing right now. It replaces scrolling through verbose updates.

**Where you see it:**
- **The dock** (Mod Hub's line above the prompt): `◎ 64% ⣿⣿⣿⣿⣷⣀⣀ 3/5 ~8m — <now>` while working, then `✓ done 6m53s` until your next prompt.
- **The "Working…" row** shows the same while Claude works.
- **Plan** in the dock (or `/mission`) toggles a pane with the checklist (✓ done with time taken, ▶ current, ○ to do) and a **Trail**: the last "now" lines with timestamps, a condensed history of the work.

**How it works:** the mod gives Claude a tool, `mcp__mission-control__plan`. For tasks with 3+ steps or over ~2 minutes, Claude posts a plan (3-8 steps, each sized 1-3), then updates it as steps start and finish. The mod does the maths:
- **% done** = finished step sizes + partial credit for the current step.
- **Time left** = remaining size × pace. Pace comes from this task's finished steps, blended with your earlier tasks in the same project.
- Shown as **≈** ("rough") until a step finishes or history exists.
- Only active time counts. Time waiting for you between turns does not.

**Cost:** a short hidden reminder (~60 tokens) is attached to each prompt you send, plus a few small tool calls per task. No extra model calls.

**Data saved:** `~/.claude/mods-data/mission-control/<session>.json`: finished tasks' size and duration, used to calibrate future estimates.

**Limits:** the estimate is only as good as the plan. If scope grows, Claude adds steps and the % drops. It's an estimate, not a promise.

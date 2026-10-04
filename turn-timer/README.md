# Turn Timer

**What it does:** records how long every prompt took, so you can look back later.

**Where you see it:**
- After every reply, a dim row in the chat: `⏱ 6m 41s · 23 tool calls · 12k tokens written · Opus 5.5`. It is saved in the transcript, so it's still there when you reopen the session. Claude never reads it (no token cost).
- `/timings`: the last 15 prompts in this project, with average, median, total and longest.
- `/timings all`: every project, plus a per-project summary.
- `/timings 40`: the last 40.

**How it works:** the app reports each turn's exact wall-clock length when it ends. The mod adds tool-call count, output tokens and model, then appends the row.

**Cost:** none. No model calls.

**Data saved:** `~/.claude/mods-data/turn-timer/<session>.json`, one file per session (so parallel sessions never overwrite each other). Each record holds the time, project, first 140 characters of the prompt, duration, tool calls, output tokens and model. Delete the folder to wipe history.

**Notes:** "interrupted" marks turns you stopped. The desktop app does not show the terminal's "Worked for…" line, which is why this exists.

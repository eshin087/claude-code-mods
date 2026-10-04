# Next Tasks

**What it does:** after a longer piece of work, suggests the 3 best next tasks for the project, ready to run with one click.

**Where you see it:** after any turn of 1 minute or more, a small card opens above the dock once, with a blank line between it and the dock:
```
Next                                   ✕
[1] Add a seam test for tiles
[2] Write an ADR: tiles in repo vs R2
[3] Profile far-tile blits
```
- **Click the boxed number or the task** to do it: its full instruction goes into your prompt box, or is sent where the app has no box it can fill.
- **✕** dismisses the suggestions.
- **Auto-hide:** if you don't answer within **10 seconds**, the card folds into the dock's **N** (amber dot). Click **N** to bring it back, with a fresh 10 seconds each time.
- It also folds when you send your next prompt. Suggestions expire after 3 of your prompts.
- **`/next`** asks over the whole conversation instead of the last turn: smarter, any time.

**How it works:**
- **Automatic:** Haiku reads a short summary of the turn (what you asked, files changed, commands run, the final report) and replies with three tasks: one to continue the work, one quality step (tests, review, docs, refactor), and one forward-looking step.
- **`/next`:** forks your session and asks the same question with the full context. The fork is served from the session's prompt cache.

**Cost:**
- **Automatic:** one small Haiku call per long turn, about 2-3k tokens in and 300 out (well under a cent).
- **`/next`:** re-reads your conversation from cache on the session's model. Cheap per token, but a big context adds up, so it's on demand only.

**Data saved:** none.

**Settings:** `MIN_TURN_MS`, `MODEL` and `AUTO_HIDE_MS` at the top of `hooks/register.tsx`.

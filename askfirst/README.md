# Ask first

**What it does:** an "ask me first" switch. While it is on, Claude asks the clarifying questions it needs before it starts any non-trivial task, so you don't have to end every prompt with "ask me any questions to help you out".

**Where you see it:**
- **`/askfirst`** flips the switch; `/askfirst on` and `/askfirst off` set it. It answers *Ask-first is on.* or *Ask-first is off.*
- While it is on, a dim **ask first** label sits with the mode labels at the right of the footer. No button: the footer is crowded already.
- The questions come as Claude's usual question picker (the AskUserQuestion tool): 2 to 4 questions, the option Claude recommends first and marked *(Recommended)*.

**How it decides:** while the switch is on, every prompt Claude is sent carries one extra paragraph in its system prompt telling it to ask first. Claude itself judges what counts as trivial: a one-line fix, a quick lookup, a plain question, or a request that already says everything gets no questions; it just does the work. It asks once, up front, not again mid-task.

**Data saved:** just the switch, in the mod's own store (a small JSON file Claude Code keeps for it under your Claude folder). So it holds across chats and restarts. It starts off. A flip in one chat reaches your other open chats on their next prompt (their footer label catches up on its next redraw).

**Cost:** no extra model calls. While on, a few lines more of system prompt per request, and the questions Claude asks.

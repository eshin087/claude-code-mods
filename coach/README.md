# Coach

**What it does:** shows the numbers behind your sessions that drive cost and quality, checks your habits against a normal software lifecycle (SDLC), and teaches one architect-level concept at a time, tied to what you just did. The aim is to carry vibe-coding skill into real engineering work.

**Where you see it:**
- **C** in the dock (or `/coach`) toggles the panel:
  ```
  ● Cache    92%   ━━━━━━━━━━━  reusing context well
  ● Context  41%   ━━━━━━━━━━━  room to spare
  ● Cost     $3.20             $0.27 per turn
  Habits   ✓ Plan  ✓ Branch  ✗ Tests  ✓ Commits  · PR
  Do next  Run the tests: 8 edits since the last run
  Tokens   120k fresh  4.1M cached  300k cache-write  52k out
  Model    claude-opus-5-5  effort high  subagents 4 runs · 31% of tokens
  Lesson   The test pyramid
           Many fast unit tests at the base, fewer integration tests…
  ```
  - **Colors:** green is good, yellow means watch it, red means act. In the token row, cached tokens are green (cheap), cache-writes yellow and output cyan.
  - **More** adds the lesson's "try next" and "at work" notes (with **Another lesson**) and a Claude Code pro tip (with **Next tip** and links).
- **Hover C** in the dock for a violet card with the cache and context bars, cost, habits and "do next".
- **One tip after a turn, only when a rule fires,** as a dim `🎓 Coach · …` row in the chat:
  - committed straight to main
  - cache hit under 50% on a big turn (with the likely cause)
  - context over 75% full
  - 5+ edits since tests last ran
  - a turn costing over ~$2
  - 10+ minutes of building with no plan
  - subagents using over half the tokens

  The same tip waits at least 6 turns before repeating.

**Glossary:**
- **Prompt cache:** the app re-sends the whole conversation every turn. A cache hit means that prefix was reused and billed at ~10% of fresh input. Hits break on model switches, CLAUDE.md or memory edits, /compact, or idle gaps (the cache expires).
- **Context fill:** how much of the model's window the conversation uses. Fuller means slower, pricier, and lower quality near the limit.
- **Cost:** API prices. On a subscription this is the value you used, not a bill, but it tracks how fast you burn your 5-hour window.

**How it works:** everything comes from what the app already reports (token usage per turn, session cost and context, tool calls such as edits, tests, commits and `gh pr create`). No model calls.

**Cost:** none.

**Data saved:** none on disk. Stats live for the session.

# Timings

**What it does:** shows how long each prompt took, how many tokens it used and what it would have cost at API prices, and the totals for the whole chat.

**Where you see it:**
- **On each prompt in the chat:** once its reply finishes, the prompt's row gets a line under it:
  ```
  fix the footer colors
  ⏱ 3m 12s · 1.2M tokens · $0.84
  ```
  Only how the row is drawn changes; the stored message stays as you typed it.
- **🔸 in the footer, desktop and terminal:** a small orange button that opens the history pane on a click and closes it on another (`/timings` does the same). It shows no time itself; the pane has every figure, and the [pace](../pace/README.md) panel shows the chat's working time (`Worked 1h42m over 12 prompts`).
- **The pane, This chat:** one row per prompt (number, its first line, time, tokens, cost), then a rule and a bold **Total** row with the prompt count and each total under its own column. Below it: how long the chat has been open, the tokens split into fresh, cached and out, and the cost at API prices.
  ```
  #    Prompt                         Time      Tokens   Cost
  1    fix the footer colors          3m 12s    1.2M     $0.84
  ─────────────────────────────────────────────────────────────
       Total · 1 prompt               3m 12s    1.2M     $0.84

  Chat open   3h 00m
  Tokens      50k fresh · 1.1M cached · 20k out
  Cost        $0.84 at API prices (what /cost shows)
  ```
- **The pane, Past chats:** every chat of this project with a history, newest first: when it started, its prompts, its first prompt, working time, tokens and cost, with the project's totals in a Total row the same way. This chat is marked ▸.

**How it counts:**
- **Time:** from your prompt to the end of Claude's reply, as the engine measures it.
- **Tokens:** every reply in the prompt, its subagents' too: input read fresh (cache writes included), input read from the cache, and output.
- **Cost:** the engine's own cost ledger (what `/cost` shows) before and after the prompt, so it's API list prices, subagents included. On a subscription it's what the same work would have cost on the API.

**Data saved:** each chat in `~/.claude/mods-data/timings/<project>/<session>.json`, so a restarted chat keeps its history.

**Cost:** none. No model calls.

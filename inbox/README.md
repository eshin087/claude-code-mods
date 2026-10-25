# Inbox

**What it does:** with several chats open at once (two or three in the same project, others elsewhere), it tells you which ones are waiting on you and why: a permission prompt that's up, a question Claude asked, or a reply that finished and that you haven't answered yet. It counts every chat on this computer, in every project.

**Where you see it:**
- **Nothing in the footer:** open the list with `/inbox` (again to close it).
- **The list (`/inbox`):** every chat that's waiting, in groups:
  ```
  Inbox                                                        Close
  Needs you
    mods · inbox             Approval  10m    wants to run Bash: npm test
    gcdAtlas · footer colors Question  3m     Which color?
  Your turn
    gcdAtlas · docs          Done      20m    Wrote the docs.
  ▸ gcdTourney · attack alts Done      0s     Merged.
  1 chat working
  ```
  "Needs you" (approvals and questions) comes first, the longest wait at the top; then "Your turn" (finished replies); then a dim count of chats still working. ▸ marks the chat you're in. Each row is the project, the chat's title (or its first prompt's first line), what it's waiting for, how long, and why. The rows are for reading: switch chats in the sidebar. The list refreshes every 5 seconds while it's open.
- **A notification** when a chat starts waiting for approval or asks a question, and when a reply that ran 2 minutes or longer finishes. Titled with the project and the chat (`gcdTourney · attack alts`), for example `Needs your approval: Bash: npm run pr -- merge 12`. One per change, never repeated.

**How it decides:**
- **Working:** from your prompt until the reply ends.
- **Approval:** a permission prompt is up (the engine's permission request, or its "needs your permission" notice). It clears as soon as that tool call goes ahead or is refused; another call finishing beside it doesn't clear it.
- **Question:** Claude called AskUserQuestion, or an MCP server asked for input. It clears once you answer.
- **Done:** the reply finished; the reason is its first line. It stays until your next prompt. A reply you stopped yourself counts as nothing waiting.
- **Gone quiet:** a chat that closes says so and leaves the list. One that crashed or was killed without saying so drops off once its record is 12 hours old.

**Data saved:** each chat keeps one small file, `~/.claude/mods-data/inbox/<session>.json` (or under `CLAUDE_CONFIG_DIR` when that's set): its project, title, state, reason and times. A closed chat's file stays, marked idle; mods can't delete files, so the folder grows by one tiny file per chat.

**Cost:** none. No model calls. Each chat reads the folder every 10 seconds (every 5 while the list is open) and writes its own file only when its state changes.

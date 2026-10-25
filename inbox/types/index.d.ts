/**
 * Where a chat stands with its person:
 * - `approval`: a permission prompt is up.
 * - `question`: Claude asked something (AskUserQuestion, an MCP server's form).
 * - `done`: the reply finished and the person hasn't sent the next prompt.
 * - `working`: a reply is under way.
 * - `idle`: nothing to say (a fresh chat, a stopped reply, a closed chat).
 */
export type InboxState = 'approval' | 'question' | 'done' | 'working' | 'idle'

/** One chat, as ~/.claude/mods-data/inbox/<sessionId>.json keeps it. */
export type InboxRecord = {
  sessionId: string
  /** The project folder's name; a worktree counts as its main repository. */
  project: string
  /** The chat's title, or the first line of its first prompt; '' before either. */
  title: string
  state: InboxState
  /** Why, in a few words: what it wants to run, what it asked, how its reply began. */
  reason: string
  /** When the state began (ms). */
  since: number
  /** When the file was last written (ms): a record left this long unwritten is a chat gone quiet. */
  updatedAt: number
}

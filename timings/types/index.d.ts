/** Tokens over a prompt's replies, subagents' included: read fresh (cache writes too), read from the cache, written out. */
export type PromptTokens = { tokensIn: number; tokensCached: number; tokensOut: number }

/** One finished prompt. */
export type PromptRecord = PromptTokens & {
  turnId: string
  /** When it was sent (ms). */
  at: number
  /** Its first line, for the pane. */
  prompt: string
  /** What its row in the chat shows, to find the row again: length and start of the text. */
  match: string
  durationMs: number
  /** What it cost at API prices, as /cost counts it; null where the host keeps no cost ledger. */
  usd: number | null
}

/** One chat's history, as ~/.claude/mods-data/timings/<project>/<session>.json keeps it. */
export type ChatTimings = { sessionId: string; project: string; startedAt: number; prompts: PromptRecord[] }

/** A chat in the Past chats list. */
export type ChatSummary = { sessionId: string; startedAt: number; title: string; prompts: number; workedMs: number; tokens: number; usd: number | null }

declare module 'claude-code' {
  interface PluginState {
    timings: {
      chat: ChatTimings | null
      isOpen: boolean
      view: 'chat' | 'past'
      past: ChatSummary[]
    }
  }
}

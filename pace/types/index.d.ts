/** What this chat has used so far. */
export type PaceSession = {
  /** Input tokens read fresh (cache writes included), read from the cache, and written out: every reply, subagents' too. */
  tokensIn: number
  tokensCached: number
  tokensOut: number
  /** Your turns in this chat. */
  turns: number
  /** Dollars, as /cost totals it; null before the first priced reply. */
  usd: number | null
  /** How far the 5-hour and weekly % rose between this chat's replies (other chats running meanwhile count too). */
  fiveUp: number
  weekUp: number
}

declare module 'claude-code' {
  interface PluginState {
    pace: {
      isOpen: boolean
      session: PaceSession
    }
  }
}

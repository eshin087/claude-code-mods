export type CoachTokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type CoachStats = {
  project: string
  model: string
  effort: string | null
  turns: number
  main: CoachTokens
  last: (CoachTokens & { ms: number; costUsd: number | null; model: string }) | null
  sub: CoachTokens & { runs: number }
  contextTokens: number | null
  contextWindow: number | null
  costUsd: number | null
  files: string[]
  edits: number
  editsSinceTest: number
  testsRun: number
  commits: number
  commitsOnMain: number
  prsOpened: number
  branch: string | null
  planUsed: boolean
  perfRuns: number
  tipsShown: { [id: string]: number }
}

declare module 'claude-code' {
  interface PluginState {
    coach: { stats: CoachStats | null; lesson: number; tip: number; unseen: boolean; isOpen: boolean; lastTip: string | null; isMore: boolean }
  }
}

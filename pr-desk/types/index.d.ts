export type DeskChecks = 'passing' | 'failing' | 'pending' | 'none'

export type DeskPr = {
  repo: string
  number: number
  title: string
  branch: string
  url: string
  preview: string | null
  isPreviewGuess: boolean
  mergeable: string
  checks: DeskChecks
  isDraft: boolean
  updatedAt: string
  worktree: string | null
}

export type Desk = { at: number; prs: DeskPr[]; errors: string[] }

declare module 'claude-code' {
  interface PluginState {
    'pr-desk': { desk: Desk | null; isLoading: boolean; isOpen: boolean }
  }
}

export type NextItem = { title: string; why: string; prompt: string }

export type NextCard = {
  project: string
  items: NextItem[]
  isLoading: boolean
  source: 'auto' | 'full'
  error: string | null
  /** Expanded above the dock; collapsed it is just the dock's Next badge. */
  isOpen: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'next-tasks': { card: NextCard | null }
  }
}

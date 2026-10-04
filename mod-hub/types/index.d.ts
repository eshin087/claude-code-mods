export type HubMod = {
  folder: string
  name: string
  description: string
  version: string
  isOn: boolean
  readme: string | null
}

/**
 * A dock press for another mod: `target` is the mod's name; `seq` makes each press a new write.
 * `action: 'review'` (target `*`) asks every mod to show its panel at once.
 */
export type HubSignal = { seq: number; target: string; action?: 'toggle' | 'review' }

/** One background task for the T tab: a running agent, or a shell/monitor/workflow from the last reply. */
export type HubTask = { id: string; kind: string; label: string; status: string }

declare module 'claude-code' {
  interface PluginState {
    'mod-hub': {
      mods: HubMod[]
      expanded: string | null
      root: string
      signal: HubSignal | null
      isCollapsed: boolean
      isOpen: boolean
      /** The tab the pointer is over, whose card the dock shows; null for none. */
      peek: string | null
      tasks: HubTask[]
      /** Whether the app's own Background tasks pane is open. */
      tasksOpen: boolean
    }
  }
}

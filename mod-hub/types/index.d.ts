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

declare module 'claude-code' {
  interface PluginState {
    'mod-hub': {
      mods: HubMod[]
      expanded: string | null
      root: string
      signal: HubSignal | null
      isCollapsed: boolean
      isOpen: boolean
    }
  }
}

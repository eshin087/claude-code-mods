export type HubMod = {
  folder: string
  name: string
  description: string
  version: string
  /** Not on this computer's off list (~/.claude/mods-data/mod-hub/off.json). */
  isOn: boolean
  /** Listed before mod-hub in CLAUDE_CODE_PLUGIN_DIRS: it loads before the hub can refuse it. */
  isAheadOfHub: boolean
  readme: string | null
}

/**
 * A press for another mod: `target` is the mod's name; `seq` makes each press a new write.
 * `action: 'review'` (target `*`, from /mods-review) asks every mod to show its panel at once.
 */
export type HubSignal = { seq: number; target: string; action?: 'toggle' | 'review' }

declare module 'claude-code' {
  interface PluginState {
    'mod-hub': {
      mods: HubMod[]
      expanded: string | null
      root: string
      signal: HubSignal | null
      isOpen: boolean
    }
  }
}

/** One mod in the mods folder, as the /mods page lists it. */
export type HubMod = {
  folder: string
  name: string
  description: string
  version: string
  /** Not on this computer's off list (~/.claude/mods-data/hub/off.json). */
  isOn: boolean
  /** Listed before the hub in CLAUDE_CODE_PLUGIN_DIRS: it loads before the hub can refuse it. */
  isAheadOfHub: boolean
  readme: string | null
}

declare module 'claude-code' {
  interface PluginState {
    hub: {
      mods: HubMod[]
      /** The folder whose details are open on the page; null for none. */
      expanded: string | null
      root: string
      isOpen: boolean
    }
  }
}

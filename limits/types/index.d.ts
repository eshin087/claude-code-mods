/** One usage window: how full it is (0-100) and when it resets (ISO 8601), as the account reports it. */
export type LimitWindow = { pct: number; resetsAt: string | null }

/** The account's 5-hour and weekly windows at one moment (`at`, ms). */
export type LimitsReading = { at: number; five: LimitWindow | null; week: LimitWindow | null }

/**
 * What every open session shares in ~/.claude/mods-data/limits/readings.json:
 * the latest reading, a short history (the pace mod's input), and when the
 * account endpoint was last asked and what went wrong, if anything.
 */
export type LimitsFile = {
  latest: LimitsReading | null
  history: LimitsReading[]
  checkedAt: number
  error: string | null
  errorAt: number | null
}

/** One window as the footer draws it; `reset` the countdown to its reset ("1h17"), null when it isn't shown; `msLeft` the time to the reset in ms, shown or not. */
export type FooterPart = { label: string; pct: number; reset: string | null; msLeft: number | null }

declare module 'claude-code' {
  interface PluginState {
    limits: {
      reading: LimitsReading | null
    }
  }
}

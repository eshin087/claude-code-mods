/** One rate-limit window as the meter draws it (five_hour, seven_day, ...). */
export type MeterLimit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { limits: MeterLimit[] }
  }
}

export type MissionStep = {
  text: string
  /** Relative effort, 1 (small) to 3 (large). */
  size: number
  status: 'todo' | 'doing' | 'done'
  /** Active time (ms into the mission) when the step started / finished. */
  startActive?: number
  doneActive?: number
}

export type MissionNote = { atActive: number; text: string }

export type Mission = {
  id: string
  title: string
  project: string
  steps: MissionStep[]
  now: string
  notes: MissionNote[]
  /** Active time banked before `runningSince`; turns waiting on the person do not count. */
  activeMs: number
  runningSince: number | null
  isFinished: boolean
  /** ms per unit of step size from earlier missions, when there are any. */
  calibration: number | null
}

/** What the dock shows, refreshed every second while a mission runs. */
export type MissionSummary = {
  title: string
  pct: number
  stepNo: number
  total: number
  left: string | null
  elapsedMs: number
  isFinished: boolean
  now: string
}

declare module 'claude-code' {
  interface PluginState {
    'mission-control': { mission: Mission | null; summary: MissionSummary | null; isOpen: boolean }
  }
}

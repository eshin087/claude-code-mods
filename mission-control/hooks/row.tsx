import type { ClientModule } from 'claude-code'

// The working row on the desktop, drawn by the surface so it animates on its
// own frame clock (nothing goes back to the hooks module per frame): a spinner
// that cycles color, the % done, a short gradient bar with a glint running
// through it and a pulsing leading edge, the step number, time on task, time
// left (amber when the step runs long), and a "plan ›" link. A click on the
// row tells the hooks module ({ open: 'plan' }), which toggles the Mission
// pane with the whole checklist.

type Props = {
  pct: number
  stepNo: number
  total: number
  elapsed: string
  left: string | null
  pace: 'ok' | 'slow' | 'rough'
  isPlanOpen: boolean
}
type State = { frame: number; isHover: boolean }

const FRAME_MS = 80
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
// The spinner's colors (cyan to teal, the dock's Plan color), cycled smoothly;
// the bar runs from the first to the fourth.
const HUES = ['#22d3ee', '#38bdf8', '#67e8f9', '#2dd4bf', '#5eead4', '#2dd4bf', '#67e8f9', '#38bdf8']
const BAR_CELLS = 6
const TRACK = '#3f3f46'
const GLINT = '#f0f9ff'
const ACCENT = '#22d3ee'
const ACCENT_HOVER = '#a5f3fc'
const PACE = { ok: '#4ade80', slow: '#facc15', rough: '#9ca3af' } as const

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const mix = (from: string, to: string, t: number) => {
  const a = rgb(from)
  const b = rgb(to)
  return `#${a.map((v, i) => Math.round(v + (b[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`
}
const hueAt = (frame: number) => {
  const pos = (frame / 3) % HUES.length
  const k = Math.floor(pos)
  return mix(HUES[k]!, HUES[(k + 1) % HUES.length]!, pos - k)
}
// 0..1, once round every ~1.5 s.
const pulse = (frame: number) => (Math.sin(frame / 3) + 1) / 2

const Row: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ frame: 0, isHover: false })
    surface.every(FRAME_MS, () => {
      const cur = surface.state
      if (cur) surface.setState({ ...cur, frame: cur.frame + 1 })
    })
  }
  const st = surface.state ?? { frame: 0, isHover: false }
  const frame = st.frame

  // Set on every draw so the listener always reads the current state.
  surface.onPointer(e => {
    const now = surface.state ?? { frame: 0, isHover: false }
    if (e.type === 'up') surface.post({ open: 'plan' })
    const isHover = e.type !== 'leave'
    if (isHover !== now.isHover) surface.setState({ ...now, isHover })
  })

  // Full cells shade cyan to teal with a glint sweeping across them; the
  // cell being filled pulses; the rest is track.
  const pct = Math.max(0, Math.min(1, props.pct))
  const full = Math.floor(pct * BAR_CELLS)
  const sweep = (frame % (full + 6)) - 3
  const cells = Array.from({ length: BAR_CELLS }, (_, i) => {
    if (i < full) {
      const base = mix(HUES[0]!, HUES[3]!, i / (BAR_CELLS - 1))
      const d = Math.abs(i - sweep)
      return <Text color={d === 0 ? mix(base, GLINT, 0.7) : d === 1 ? mix(base, GLINT, 0.3) : base}>━</Text>
    }
    if (i === full && pct < 1) return <Text color={mix(TRACK, HUES[3]!, 0.3 + 0.7 * pulse(frame))}>━</Text>
    return <Text color={TRACK}>━</Text>
  })
  const left = props.left === null ? 'estimating…' : props.pace === 'slow' ? `${props.left} · step running long` : props.left

  return (
    <Box flexDirection="row" gap={1} flexWrap="nowrap" overflow="hidden" alignItems="center" height={1}>
      <Text bold color={hueAt(frame)}>
        {SPIN[frame % SPIN.length]}
      </Text>
      <Text bold color="#f4f4f5">
        {`${Math.round(pct * 100)}%`}
      </Text>
      <Box flexDirection="row" flexShrink={0}>
        {cells}
      </Box>
      <Text bold color={ACCENT}>{`${props.stepNo}/${props.total}`}</Text>
      <Text color="#71717a">·</Text>
      <Text color="#9ca3af">{props.elapsed}</Text>
      <Text color="#71717a">·</Text>
      <Text color={props.left === null ? PACE.rough : PACE[props.pace]}>{left}</Text>
      <Text color="#71717a">·</Text>
      <Text color={st.isHover ? ACCENT_HOVER : ACCENT} underline={st.isHover}>
        {props.isPlanOpen ? 'hide plan' : 'plan ›'}
      </Text>
    </Box>
  )
}

export default Row

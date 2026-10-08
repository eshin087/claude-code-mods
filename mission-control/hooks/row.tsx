import type { ClientModule } from 'claude-code'

// The working row on the desktop, drawn by the surface so it animates on its
// own frame clock (nothing goes back to the hooks module per frame): a spinner
// that cycles color, a gradient bar with a shimmer running through it and a
// pulsing leading edge, one dot per step (the current one pulsing), the step's
// name, time left (amber when the step runs long), and the "now" line, typed
// in each time it changes.

type Status = 'done' | 'doing' | 'todo'
type Props = {
  pct: number
  steps: Status[]
  stepNo: number
  total: number
  step: string
  elapsed: string
  left: string | null
  pace: 'ok' | 'slow' | 'rough'
  now: string
}
type State = { frame: number; now: string; nowAt: number }

const FRAME_MS = 80
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
// The spinner's colors, cycled smoothly; the bar runs from the first to the fourth.
const HUES = ['#22d3ee', '#38bdf8', '#818cf8', '#a78bfa', '#c084fc', '#a78bfa', '#818cf8', '#38bdf8']
const BAR_CELLS = 14
const TRACK = '#3f3f46'
const GLINT = '#f0f9ff'
const DONE = '#4ade80'
const TODO = '#52525b'
const VIOLET = '#a78bfa'
const PACE = { ok: '#4ade80', slow: '#facc15', rough: '#9ca3af' } as const
// Characters of the "now" line typed per frame.
const TYPE_RATE = 4

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
    surface.setState({ frame: 0, now: props.now, nowAt: 0 })
    surface.every(FRAME_MS, () => {
      const cur = surface.state
      if (cur) surface.setState({ ...cur, frame: cur.frame + 1 })
    })
  }
  const st = surface.state ?? { frame: 0, now: props.now, nowAt: 0 }
  const frame = st.frame
  // A new "now" line types itself in from the start.
  if (props.now !== st.now) surface.setState({ ...st, now: props.now, nowAt: frame })
  const typedFrom = props.now !== st.now ? frame : st.nowAt
  const typed = props.now.slice(0, Math.max(0, (frame - typedFrom) * TYPE_RATE))
  const isTyping = typed.length < props.now.length

  // The bar: full cells shade cyan to violet with a glint sweeping across
  // them; the cell being filled pulses; the rest is track.
  const pct = Math.max(0, Math.min(1, props.pct))
  const full = Math.floor(pct * BAR_CELLS)
  const sweep = (frame % (full + 8)) - 4
  const cells = Array.from({ length: BAR_CELLS }, (_, i) => {
    if (i < full) {
      const base = mix(HUES[0]!, HUES[3]!, BAR_CELLS > 1 ? i / (BAR_CELLS - 1) : 0)
      const d = Math.abs(i - sweep)
      return <Text color={d === 0 ? mix(base, GLINT, 0.7) : d === 1 ? mix(base, GLINT, 0.3) : base}>━</Text>
    }
    if (i === full && pct < 1) return <Text color={mix(TRACK, HUES[3]!, 0.3 + 0.7 * pulse(frame))}>━</Text>
    return <Text color={TRACK}>━</Text>
  })
  const dots = props.steps.slice(0, 12).map(s =>
    s === 'done' ? <Text color={DONE}>●</Text> : s === 'doing' ? <Text color={mix(HUES[0]!, GLINT, pulse(frame))}>◉</Text> : <Text color={TODO}>○</Text>,
  )
  const left = props.left === null ? 'estimating…' : props.pace === 'slow' ? `${props.left} · step running long` : props.left

  return (
    <Box flexDirection="row" gap={1} flexWrap="nowrap" overflow="hidden" alignItems="center">
      <Text bold color={hueAt(frame)}>
        {SPIN[frame % SPIN.length]}
      </Text>
      <Box flexShrink={0}>
        <Text bold color="#f4f4f5">
          {`${Math.round(pct * 100)}%`.padStart(4)}
        </Text>
      </Box>
      <Box flexDirection="row" flexShrink={0}>
        {cells}
      </Box>
      <Box flexDirection="row" flexShrink={0}>
        {dots}
      </Box>
      <Box flexShrink={1} minWidth={8}>
        <Text wrap="truncate-end">
          <Text bold color={VIOLET}>{`${props.stepNo}/${props.total}`}</Text>
          <Text color="#e4e4e7">{props.step ? ` ${props.step}` : ''}</Text>
        </Text>
      </Box>
      <Box flexDirection="row" gap={1} flexShrink={0}>
        <Text color="#71717a">·</Text>
        <Text color="#9ca3af">{props.elapsed}</Text>
        <Text color="#71717a">·</Text>
        <Text color={props.left === null ? PACE.rough : PACE[props.pace]}>{left}</Text>
      </Box>
      {props.now !== '' && (
        <Box flexShrink={3} minWidth={0}>
          <Text wrap="truncate-end">
            <Text color={VIOLET}>› </Text>
            <Text italic color="#a1a1aa">
              {typed}
            </Text>
            <Text color={HUES[0]}>{isTyping && frame % 4 < 2 ? '▌' : ''}</Text>
          </Text>
        </Box>
      )}
    </Box>
  )
}

export default Row

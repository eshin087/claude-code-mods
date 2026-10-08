import type { ClientModule } from 'claude-code'

// The working row on the desktop, drawn by the surface so it animates on its
// own frame clock (nothing goes back to the hooks module per frame): a spinner
// that cycles color, the % done, a short gradient bar with a glint running
// through it and a pulsing leading edge, the step number, time on task and
// time left (amber when the step runs long), then one line on what is going
// on: Claude's latest thought while it thinks, else its "now" line, else what
// the app says the step is doing, else the step's name. That line is a single
// Text in a one-row box: it ends in "…" when space runs out, and never wraps.

type Kind = 'thought' | 'now' | 'app' | 'step'
type Props = {
  pct: number
  stepNo: number
  total: number
  elapsed: string
  left: string | null
  pace: 'ok' | 'slow' | 'rough'
  text: string
  kind: Kind
}
type State = { frame: number; text: string; textAt: number }

const FRAME_MS = 80
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
// The spinner's colors, cycled smoothly; the bar runs from the first to the fourth.
const HUES = ['#22d3ee', '#38bdf8', '#818cf8', '#a78bfa', '#c084fc', '#a78bfa', '#818cf8', '#38bdf8']
const BAR_CELLS = 6
const TRACK = '#3f3f46'
const GLINT = '#f0f9ff'
const VIOLET = '#a78bfa'
const PACE = { ok: '#4ade80', slow: '#facc15', rough: '#9ca3af' } as const
// How each kind of line is marked and colored: a thought is Claude's live
// thinking, so it reads apart from the "now" line it wrote for you.
const LINE = {
  thought: { mark: '✻ ', color: '#c4b5fd', italic: true },
  now: { mark: '› ', color: '#e4e4e7', italic: false },
  app: { mark: '› ', color: '#a1a1aa', italic: false },
  step: { mark: '› ', color: '#a1a1aa', italic: false },
} as const
// Characters of a new line typed per frame (thoughts stream in by themselves).
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
    surface.setState({ frame: 0, text: props.text, textAt: 0 })
    surface.every(FRAME_MS, () => {
      const cur = surface.state
      if (cur) surface.setState({ ...cur, frame: cur.frame + 1 })
    })
  }
  const st = surface.state ?? { frame: 0, text: props.text, textAt: 0 }
  const frame = st.frame
  // A new line types itself in from the start; a thought shows as it streams.
  if (props.text !== st.text) surface.setState({ ...st, text: props.text, textAt: frame })
  const typedFrom = props.text !== st.text ? frame : st.textAt
  const typed = props.kind === 'thought' ? props.text : props.text.slice(0, Math.max(0, (frame - typedFrom) * TYPE_RATE))
  const caret = typed.length < props.text.length && frame % 4 < 2 ? '▌' : ''

  // Full cells shade cyan to violet with a glint sweeping across them; the
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
  const line = LINE[props.kind]

  return (
    <Box flexDirection="row" gap={1} flexWrap="nowrap" overflow="hidden" alignItems="center" height={1}>
      <Text bold color={hueAt(frame)}>
        {SPIN[frame % SPIN.length]}
      </Text>
      <Box flexShrink={0}>
        <Text bold color="#f4f4f5">
          {`${Math.round(pct * 100)}%`}
        </Text>
      </Box>
      <Box flexDirection="row" flexShrink={0}>
        {cells}
      </Box>
      <Box flexDirection="row" gap={1} flexShrink={0}>
        <Text bold color={VIOLET}>{`${props.stepNo}/${props.total}`}</Text>
        <Text color="#71717a">·</Text>
        <Text color="#9ca3af">{props.elapsed}</Text>
        <Text color="#71717a">·</Text>
        <Text color={props.left === null ? PACE.rough : PACE[props.pace]}>{left}</Text>
      </Box>
      {props.text !== '' && (
        <Box flexGrow={1} flexShrink={1} minWidth={0} height={1} overflow="hidden">
          <Text wrap="truncate-end" italic={line.italic} color={line.color}>
            {`${line.mark}${typed}${caret}`}
          </Text>
        </Box>
      )}
    </Box>
  )
}

export default Row

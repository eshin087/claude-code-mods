import type { ClientModule } from 'claude-code'

// The dock's tab strip, drawn by the surface so it knows which letter the mouse
// is over. It tells the hub which tab is hovered ({ hover }) and which was
// clicked ({ press }); the hub then draws a single popup in one fixed place.
// Each tab is a dot (green: panel open, amber: something new) and a letter chip.

type Tab = { id: string; letter: string; dot: 'open' | 'new' | null }
type Props = { tabs: Tab[] }
type State = { hover: string | null; down: string | null }

const GAP = 1
// Cells per tab: the dot, then the letter with a space on each side.
const widthOf = (t: Tab) => 1 + t.letter.length + 2

const tabAt = (tabs: readonly Tab[], x: number) => {
  let left = 0
  for (const t of tabs) {
    const w = widthOf(t)
    if (x >= left && x < left + w) return t.id
    left += w + GAP
  }
  return null
}

const Tabs: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const st = surface.state ?? { hover: null, down: null }

  // Set on every draw so the listener always reads the current tabs.
  surface.onPointer(e => {
    const now = surface.state ?? { hover: null, down: null }
    const id = e.type === 'leave' ? null : tabAt(props.tabs, e.x)
    if (e.type === 'down') {
      surface.setState({ ...now, down: id })
      return
    }
    if (e.type === 'up') {
      if (id !== null && id === now.down) surface.post({ press: id })
      surface.setState({ ...now, down: null })
      return
    }
    if (id !== now.hover) {
      surface.setState({ ...now, hover: id })
      surface.post({ hover: id })
    }
  })

  return (
    <Box flexDirection="row" gap={GAP}>
      {props.tabs.map(t => {
        const isHover = st.hover === t.id
        return (
          <Box key={t.id} flexDirection="row" width={widthOf(t)}>
            <Text color={t.dot === 'open' ? 'success' : t.dot === 'new' ? 'warning' : undefined}>{t.dot ? '●' : ' '}</Text>
            <Text color="white" backgroundColor={isHover ? '#4b5263' : '#2d313a'} bold={isHover}>
              {` ${t.letter} `}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

export default Tabs

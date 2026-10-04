// Usage meter: colored bars in the footer's mode slot, plain-text fallback.
// `claude plugin test` here.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = Date.parse('2026-10-03T20:00:00Z')

type Limit = { kind: string; percentUsed: number; resetsAt?: string }
const LIMITS: Limit[] = [
  { kind: 'five_hour', percentUsed: 38, resetsAt: new Date(NOW + (2 * 60 + 10) * 60_000).toISOString() },
  { kind: 'seven_day', percentUsed: 18 },
]

const world = (on: On, rateLimits: Limit[] = LIMITS, store: Record<string, unknown> = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const status: { text: string | undefined } = { text: undefined }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { window: 200_000 },
      rateLimits,
    },
  }))
  on('ui.status', ($, e) => {
    status.text = e.text
    return { value: undefined }
  })
  on('store.get', ($, e) => ({ value: store[e.key] }))
  on('store.set', ($, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('store.delete', ($, e) => {
    delete store[e.key]
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return { clock, status, store }
}

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const texts = (n: unknown, out: Node[] = []): Node[] => {
  if (n && typeof n === 'object') {
    const node = n as Node
    if (node.type === 'Text') out.push(node)
    for (const c of node.children ?? []) texts(c, out)
  }
  return out
}
const textOf = (n: Node) => (n.children ?? []).filter(c => typeof c === 'string').join('')

test('[terminal] the footer shows a cyan 5h bar, a violet W bar, the reset time and a small level dot', async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const all = texts(await ui.drawn())
  const find = (s: string) => all.find(t => textOf(t) === s)
  expect(find('•')?.props?.color).toBe('success')
  expect(find('5h')?.props?.color).toBe('#22d3ee')
  expect(find('W')?.props?.color).toBe('#a78bfa')
  const bars = all.filter(t => /^[━╸]+$/.test(textOf(t))).map(t => `${textOf(t)}:${t.props?.color}`)
  expect(bars).toEqual(['━━━━:#22d3ee', '━━━━━━:#3f3f46', '━:#a78bfa', '━━━━━:#3f3f46'])
  expect(find('⟳2h10m')).toBeDefined()
})

test('[desktop] the footer is one plain 145px SVG: solid bars filled to the %, colors, reset times in its alt text', async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  const svgs: Node[] = []
  const walk = (n: unknown) => {
    if (n && typeof n === 'object') {
      if ((n as Node).type === 'Svg') svgs.push(n as Node)
      for (const c of (n as Node).children ?? []) walk(c)
    }
  }
  walk(await ui.drawn())
  expect(svgs.length).toBe(1)
  const svg = svgs[0]!.props!
  expect(svg.width).toBe(145)
  // Plain: the footer slot draws no interactive (framed) SVG, which is why the meter went missing.
  expect(svg.isInteractive).toBeUndefined()
  const source = String(svg.source)
  // One continuous track per bar, and a fill rect drawn over it in the window's color.
  expect(source).toMatch(/<rect x="24" y="4.5" width="34" height="5" rx="2.5" fill="#3f3f46"\/><rect x="24" y="4.5" width="13" height="5" rx="2.5" fill="#22d3ee"\/>/)
  expect(source).toMatch(/<rect x="97" y="4.5" width="20" height="5" rx="2.5" fill="#3f3f46"\/><rect x="97" y="4.5" width="5" height="5" rx="2.5" fill="#a78bfa"\/>/)
  expect(source).toMatch(/>38%</)
  expect(source).toMatch(/>18%</)
  expect(source).not.toMatch(/<title>/)
  expect(svg.alt).toMatch(/5-hour window: 38% used, resets in 2h10m\. Weekly: 18% used/)
})

test('the engine’s own mode labels stay, before the bars', async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'desktop', component: 'SessionMode', props: { modes: ['auto'] } })
  expect(texts(await ui.drawn()).some(t => textOf(t).startsWith('auto'))).toBe(true)
})

test('until a footer draws the bars, the plain status line carries them; after, it clears', async ($, on) => {
  const { clock, status } = world(on)
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  expect(status.text).toBe('• 5h ━── 38% W ╸─ 18%')
  await $.ui.mount({ plugin: 'usage-meter', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  await clock.advance(5_000)
  expect(status.text).toBe(undefined)
})

test('a new session shows the last reading at once, until its first reply brings a fresh one', async ($, on) => {
  const { store } = world(on, [], { last: LIMITS })
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toMatch(/>38%</)
  expect(drawn).toMatch(/>18%</)
  expect(store.last).toEqual(LIMITS)
})

test('a saved 5-hour window that has reset since is not shown (its old % would be wrong)', async ($, on) => {
  const stale = [{ kind: 'five_hour', percentUsed: 91, resetsAt: new Date(NOW - 60_000).toISOString() }, { kind: 'seven_day', percentUsed: 18 }]
  world(on, [], { last: stale })
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).not.toMatch(/>91%</)
  expect(drawn).toMatch(/>18%</)
})

test('a fresh reading is saved for the next session', async ($, on) => {
  const { store } = world(on)
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  expect(store.last).toEqual(LIMITS)
})

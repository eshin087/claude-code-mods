// Usage meter: `5h 38% · wk 18%` in the footer's mode slot, plain-text fallback.
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
// A % as drawn: `{n}%` in JSX is the number and the sign as two children.
const PCT = (n: number) => new RegExp(`[^0-9]${n}%`)

// Each window's % and its color, in order.
const shown = (all: Node[]) => all.filter(t => /^\d+%$/.test(textOf(t))).map(t => `${textOf(t)}:${t.props?.color}`)

test('[desktop] the footer is just "5h 38% · wk 18%": grey labels, each % green, amber or red by how full it is; text, no picture, no purple', async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  const drawn = await ui.drawn()
  const all = texts(drawn)
  expect(all.map(textOf)).toEqual(['5h', '38%', '·', 'wk', '18%'])
  expect(all.find(t => textOf(t) === '5h')?.props?.dimColor).toBe(true)
  expect(all.find(t => textOf(t) === 'wk')?.props?.dimColor).toBe(true)
  expect(shown(all)).toEqual(['38%:success', '18%:success'])
  expect(JSON.stringify(drawn)).not.toMatch(/"Svg"|#a78bfa|violet/)
})

test('[terminal] the same, with the 5-hour reset time', async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/x', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(texts(await ui.drawn()).map(textOf)).toEqual(['5h', '38%', '⟳2h10m', '·', 'wk', '18%'])
})

test('a % turns amber at 60 and red at 85', async ($, on) => {
  world(on, [{ kind: 'five_hour', percentUsed: 87 }, { kind: 'seven_day', percentUsed: 64 }])
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect(shown(texts(await ui.drawn()))).toEqual(['87%:error', '64%:warning'])
})

test('the engine’s own mode labels stay, before the meter', async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'desktop', component: 'SessionMode', props: { modes: ['auto'] } })
  expect(texts(await ui.drawn()).some(t => textOf(t).startsWith('auto'))).toBe(true)
})

test('until a footer draws the meter, the plain status line carries it; after, it clears', async ($, on) => {
  const { clock, status } = world(on)
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  expect(status.text).toBe('5h 38% · wk 18%')
  await $.ui.mount({ plugin: 'usage-meter', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  await clock.advance(5_000)
  expect(status.text).toBe(undefined)
})

test('a new session shows the last reading at once, until its first reply brings a fresh one', async ($, on) => {
  const { store } = world(on, [], { last: LIMITS })
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toMatch(PCT(38))
  expect(drawn).toMatch(PCT(18))
  expect(store.last).toEqual(LIMITS)
})

test('a saved 5-hour window that has reset since is not shown (its old % would be wrong)', async ($, on) => {
  const stale = [{ kind: 'five_hour', percentUsed: 91, resetsAt: new Date(NOW - 60_000).toISOString() }, { kind: 'seven_day', percentUsed: 18 }]
  world(on, [], { last: stale })
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'usage-meter', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).not.toMatch(PCT(91))
  expect(drawn).toMatch(PCT(18))
})

test('a fresh reading is saved for the next session', async ($, on) => {
  const { store } = world(on)
  await $.session.start({ cwd: 'C:/x', surface: 'desktop', isInteractive: true })
  expect(store.last).toEqual(LIMITS)
})

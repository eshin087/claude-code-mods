// Limits tests: `claude plugin test` in this folder. The account endpoint, the
// login, the files and the clock are all the test's.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'

// The test runtime has timers; its types don't say so.
declare const setTimeout: (fn: () => void, ms: number) => unknown

// 2026-10-11, 7:43 PM in the zone the test runs in.
const NOW = new Date(2026, 9, 11, 19, 43).getTime()
const at = (h: number, m: number, dayOffset = 0) => new Date(2026, 9, 11 + dayOffset, h, m, 59, 714).toISOString()
// What the usage endpoint answers: 5-hour at 22% resetting 11:09:59.7 PM, weekly at 76% resetting 8:59:59.7 PM.
const BODY = { five_hour: { utilization: 22, resets_at: at(23, 9) }, seven_day: { utilization: 76, resets_at: at(20, 59) }, seven_day_opus: null }
const HOME = 'C:/Users/test'
const FILE = `${HOME}/.claude/mods-data/limits/readings.json`
const PANE_PROPS = { modes: [] }

type WorldOptions = { status?: number; body?: unknown; hasLogin?: boolean; files?: Record<string, string>; rateLimits?: SessionRateLimit[] }

const world = (on: On, opts: WorldOptions = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = { ...opts.files }
  const fetches: { url: string; auth?: string; headers?: Record<string, string> }[] = []
  const norm = (p: string) => p.replace(/\\/g, '/')
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? HOME : undefined }))
  on('fs.read', ($, e) => {
    const text = files[norm(e.path)]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.write', ($, e) => {
    files[norm(e.path)] = e.text
    return { value: undefined }
  })
  on('session.authorize', () => ({ value: opts.hasLogin === false ? null : { handle: 'login-handle', kind: 'bearer' as const } }))
  on('http.fetch', ($, e) => {
    fetches.push({ url: e.url, auth: e.init?.auth, headers: e.init?.headers })
    const status = opts.status ?? 200
    return { value: { status, ok: status < 300, headers: {}, text: JSON.stringify(opts.body ?? BODY) } }
  })
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: opts.rateLimits ?? [] } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  const saved = () => JSON.parse(files[FILE] ?? 'null') as { latest: { five: { pct: number } | null; week: { pct: number } | null } | null; error: string | null; history: unknown[] } | null
  return { clock, files, fetches, saved }
}

const start = async ($: Engine, surface: 'desktop' | 'terminal' = 'desktop') => {
  await $.session.start({ cwd: 'C:/x/gcdAtlas', surface, isInteractive: true })
  // The first check runs off session.start's own dispatch.
  await new Promise<void>(r => setTimeout(() => r(), 30))
}

// The strings a drawing shows, in order, as one line; and each %'s color.
const strings = (n: unknown): string[] =>
  typeof n === 'string' ? [n] : n && typeof n === 'object' ? ((n as { children?: unknown[] }).children ?? []).flatMap(strings) : []
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const nodesOf = (n: unknown, out: Node[] = []): Node[] => {
  if (n && typeof n === 'object') {
    out.push(n as Node)
    for (const c of (n as Node).children ?? []) nodesOf(c, out)
  }
  return out
}
const footer = async ($: Engine, surface: 'desktop' | 'terminal') => {
  const ui = await $.ui.mount({ plugin: 'limits', surface, component: 'SessionMode', props: PANE_PROPS })
  return {
    line: async () => strings(await ui.drawn()).join(''),
    // Every piece of text with its color.
    tones: async () =>
      nodesOf(await ui.drawn())
        .filter(n => n.type === 'Text' && n.props?.color !== undefined)
        .map(n => `${strings(n).join('').trim()}:${n.props?.color}`),
  }
}

test('the footer shows 5h and weekly with the time left to each reset, read from the account endpoint with your login', async ($, on) => {
  const { fetches, saved } = world(on)
  await start($, 'terminal')
  expect(fetches).toEqual([{ url: 'https://api.anthropic.com/api/oauth/usage', auth: 'login-handle', headers: { 'anthropic-beta': 'oauth-2025-04-20' } }])
  const f = await footer($, 'terminal')
  // The 5-hour window resets 3h27m away, the weekly at 8:59:59.7 PM.
  expect(await f.line()).toBe('5h 22%⠀3h27 ⠀·⠀ w 76%')
  // The words 5h and w and the dot between are grey; the numbers keep the text color.
  expect(await f.tones()).toEqual(['5h:#9ca3af', '⠀3h27:#4ade80', '⠀·⠀:#9ca3af', 'w:#9ca3af'])
  expect(saved()?.latest).toMatchObject({ five: { pct: 22 }, week: { pct: 76 } })
})

test('only the 5-hour window has a countdown; the weekly one never does', async ($, on) => {
  world(on, { body: { five_hour: { utilization: 91, resets_at: at(23, 9) }, seven_day: { utilization: 40, resets_at: at(20, 59, 3) } } })
  await start($, 'terminal')
  expect(await (await footer($, 'terminal')).line()).toBe('5h 91%⠀3h27 ⠀·⠀ w 40%')
})

test('a % from 85% up and a countdown under 30 minutes turn red', async ($, on) => {
  world(on, { body: { five_hour: { utilization: 91, resets_at: at(20, 2) }, seven_day: { utilization: 40, resets_at: at(20, 59, 3) } } })
  await start($, 'terminal')
  const f = await footer($, 'terminal')
  // 91% is hot, 20 minutes to the reset is soon; the weekly window is neither.
  expect(await f.line()).toBe('5h 91%⠀20m ⠀·⠀ w 40%')
  expect(await f.tones()).toEqual(['5h:#9ca3af', '91%:#f87171', '⠀20m:#f87171', '⠀·⠀:#9ca3af', 'w:#9ca3af'])
})

// The 5-hour countdown shades with the time left (NOW is 7:43 PM).
const SHADES: [string, number, number, string, string][] = [
  ['green past 3 hours', 23, 9, '3h27', '#4ade80'],
  ['orange from 1 to 3 hours', 21, 43, '2h01', '#fb923c'],
  ['red under 1 hour', 20, 28, '46m', '#f87171'],
]
for (const [name, hour, minute, text, color] of SHADES) {
  test(`the 5-hour countdown is ${name}`, async ($, on) => {
    world(on, { body: { five_hour: { utilization: 20, resets_at: at(hour, minute) }, seven_day: { utilization: 40, resets_at: at(20, 59, 3) } } })
    await start($, 'terminal')
    const tones = await (await footer($, 'terminal')).tones()
    expect(tones).toContain(`⠀${text}:${color}`)
  })
}

test('desktop and terminal draw the same line', async ($, on) => {
  const { clock } = world(on)
  await start($)
  const f = await footer($, 'desktop')
  expect(await f.line()).toBe('5h 22%⠀3h27 ⠀·⠀ w 76%')
  await clock.advance(10_000)
  expect(await f.line()).toBe('5h 22%⠀3h27 ⠀·⠀ w 76%')
})

test('a reading another session made in the last 3 minutes is used as it is: no second request', async ($, on) => {
  const latest = { at: NOW - 60_000, five: { pct: 30, resetsAt: at(23, 9) }, week: { pct: 70, resetsAt: at(20, 59) } }
  const { fetches } = world(on, { files: { [FILE]: JSON.stringify({ latest, history: [latest], checkedAt: NOW - 60_000, error: null, errorAt: null }) } })
  await start($, 'terminal')
  expect(fetches).toEqual([])
  expect(await (await footer($, 'terminal')).line()).toBe('5h 30%⠀3h27 ⠀·⠀ w 70%')
})

test("each reply's headers update the footer between checks, and go into the shared history", async ($, on) => {
  const { saved } = world(on)
  await start($, 'terminal')
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 24, resetsAt: at(23, 9) }, { kind: 'seven_day', percentUsed: 77, resetsAt: at(20, 59) }],
    changed: ['rateLimits'],
  } as never)
  expect(await (await footer($, 'terminal')).line()).toBe('5h 24%⠀3h27 ⠀·⠀ w 77%')
  expect(saved()?.history.length).toBe(2)
})

test('when the endpoint fails it says why in the shared file and waits 10 minutes; the headers still show', async ($, on) => {
  const { clock, fetches, saved } = world(on, { status: 429 })
  await start($, 'terminal')
  expect(saved()?.error).toBe('the usage endpoint answered 429')
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 12, resetsAt: at(23, 9) }], changed: ['rateLimits'] } as never)
  expect(await (await footer($, 'terminal')).line()).toBe('5h 12%⠀3h27')
  await clock.advance(9 * 60_000)
  expect(fetches.length).toBe(1)
  await clock.advance(2 * 60_000)
  expect(fetches.length).toBe(2)
})

test("a reading from this session's own reply counts as fresh: the endpoint is not asked for 3 minutes", async ($, on) => {
  const { clock, fetches } = world(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 12, resetsAt: at(23, 9) }] })
  await start($)
  expect(fetches.length).toBe(0)
  await clock.advance(3 * 60_000)
  expect(fetches.length).toBe(1)
})

test("no login (an API key or another provider): nothing is asked, and the footer stays the engine's", async ($, on) => {
  const { fetches } = world(on, { hasLogin: false })
  await start($)
  expect(fetches).toEqual([])
  expect(await (await footer($, 'desktop')).line()).toBe('')
})

test('a window whose reset time has passed shows 0% until the next reading', async ($, on) => {
  const { clock } = world(on, { status: 500, rateLimits: [{ kind: 'five_hour', percentUsed: 64, resetsAt: new Date(NOW + 60_000).toISOString() }] })
  await start($, 'terminal')
  await clock.advance(2 * 60_000)
  expect(await (await footer($, 'terminal')).line()).toBe('5h 0%')
})

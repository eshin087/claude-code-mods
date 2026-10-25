// Pace tests: `claude plugin test` in this folder. The limits mod's readings
// file, the clock and the panes are the test's.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// 2026-10-11, 7:43 PM in the zone the test runs in.
const NOW = new Date(2026, 9, 11, 19, 43).getTime()
const HOUR = 3_600_000
const HOME = 'C:/Users/test'
const READINGS = `${HOME}/.claude/mods-data/limits/readings.json`
const PANE_PROPS = { title: 'Pace', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const FIVE_RESET = new Date(NOW + 3 * HOUR).toISOString()
const WEEK_RESET = new Date(NOW + 76 * 60_000).toISOString()

type Win = { pct: number; resetsAt: string }
const reading = (agoMs: number, five: number, week: number) => ({ at: NOW - agoMs, five: { pct: five, resetsAt: FIVE_RESET } as Win, week: { pct: week, resetsAt: WEEK_RESET } as Win })

const world = (on: On, history: ReturnType<typeof reading>[]) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [READINGS]: JSON.stringify({ latest: history.at(-1) ?? null, history }) }
  const toasts: string[] = []
  const panes = new Set<string>()
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
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: 'C:/x/gcdTourney' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  // The engine draws nothing of its own in the band or the footer; keyed so a test can find its node.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', ($, e) => {
    panes.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  return { clock, files, toasts, panes }
}

const start = ($: Engine) => $.session.start({ cwd: 'C:/x/gcdTourney', surface: 'desktop', isInteractive: true })
const panel = ($: Engine) => $.ui.mount({ plugin: 'pace', surface: 'desktop', component: 'Pane', requestId: 'pace', props: PANE_PROPS })
// The strings a drawing shows, in order, as one line.
const strings = (n: unknown): string[] =>
  typeof n === 'string' ? [n] : n && typeof n === 'object' ? ((n as { children?: unknown[] }).children ?? []).flatMap(strings) : []
const textOf = async (ui: Awaited<ReturnType<typeof panel>>) => strings(await ui.drawn()).join(' ').replace(/\s+/g, ' ')
const measure = ($: Engine, five: number, week: number, fiveReset = FIVE_RESET) =>
  $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: five, resetsAt: fiveReset }, { kind: 'seven_day', percentUsed: week, resetsAt: WEEK_RESET }],
    changed: ['rateLimits'],
  } as never)
const when = (t: number) => {
  const d = new Date(Math.round(t / 60_000) * 60_000)
  const h = d.getHours()
  const m = d.getMinutes()
  return `${h % 12 || 12}${m === 0 ? '' : `:${String(m).padStart(2, '0')}`}${h < 12 ? 'a' : 'p'}`
}

test('the 5-hour pace is the last hour\'s: at +24%/h it runs out before the reset, the panel says when, and a toast warns once', async ($, on) => {
  // 5-hour: 40% an hour ago, 64% now: 36% left at 24%/h is 1.5 h, before the reset in 3 h.
  // Weekly: 70% a day ago, 76% now: 6%/day, plenty for the 76 minutes to its reset.
  const { toasts } = world(on, [reading(24 * HOUR, 52, 70), reading(HOUR, 40, 74), reading(30 * 60_000, 52, 75), reading(0, 64, 76)])
  await start($)
  await measure($, 64, 76)
  expect(toasts).toEqual([`At this pace your 5-hour limit runs out around ${when(NOW + 1.5 * HOUR)}, before it resets at ${when(NOW + 3 * HOUR)}. /pace for details.`])
  await measure($, 64, 76)
  expect(toasts.length).toBe(1)
  await $.command.run({ command: 'pace', args: '' } as never)
  const text = await textOf(await panel($))
  // One row per window: a bar, the %, the time left to the reset, the pace, the outlook.
  expect(text).toContain('Window Used Resets in Pace At this pace')
  expect(text).toContain(`5-hour ██████ ░░░░ 64% 3h00m +24%/h runs out ~${when(NOW + 1.5 * HOUR)}, before the reset`)
  expect(text).toContain('Weekly ████████ ░░ 76% 1h16m +6%/day lasts until the reset')
})

test('with under 20 minutes of history the 5-hour pace says so instead of guessing', async ($, on) => {
  world(on, [reading(5 * 60_000, 20, 76), reading(0, 22, 76)])
  await start($)
  await $.command.run({ command: 'pace', args: '' } as never)
  expect(await textOf(await panel($))).toMatch(/5-hour ██ ░+ 22% 3h00m — not enough history yet/)
})

test('a window that is not rising lasts until its reset, with no warning', async ($, on) => {
  const { toasts } = world(on, [reading(HOUR, 30, 76), reading(0, 30, 76)])
  await start($)
  await measure($, 30, 76)
  expect(toasts).toEqual([])
  await $.command.run({ command: 'pace', args: '' } as never)
  expect(await textOf(await panel($))).toMatch(/5-hour ███ ░+ 30% 3h00m 0 not rising/)
})

test("this chat's tokens (subagents' too), turns, cost and working time, and how far each window rose while it ran", async ($, on) => {
  const { files } = world(on, [reading(0, 22, 76)])
  await start($)
  const usage = (fresh: number, cached: number, out: number) => ({ input_tokens: fresh, cache_creation_input_tokens: 1000, cache_read_input_tokens: cached, output_tokens: out, model: 'claude-opus-5-5' })
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage: usage(5000, 900_000, 20_000) } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 'a1', agentId: 'agent-1', reason: 'answer', usage: usage(3000, 300_000, 10_000) } as never)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], cost: { usd: 3.4 }, changed: ['cost'] } as never)
  await measure($, 22, 76)
  await measure($, 25, 76)
  await measure($, 27, 77)
  // A new 5-hour window: its first reading adds nothing.
  await measure($, 1, 77, new Date(NOW + 5 * HOUR).toISOString())
  await $.command.run({ command: 'pace', args: '' } as never)
  files[`${HOME}/.claude/mods-data/timings/gcdTourney/session-1.json`] = JSON.stringify({ prompts: [{ durationMs: 192_000 }, { durationMs: 3_000_000 }] })
  const ui = await panel($)
  const text = await textOf(ui)
  expect(text).toContain('Tokens 10k fresh · 1.2M cached · 30k out')
  expect(text).toContain('Cost $3.40 at API prices · 1 turn')
  expect(text).toContain('Used 5-hour +5% · weekly +1%')
  // The timings mod's file for this chat adds its working time to the list.
  expect(text).toContain('Worked 53m over 2 prompts · each one in /timings')
})

test('/pace opens the panel, and again closes it', async ($, on) => {
  const { panes } = world(on, [reading(0, 22, 76)])
  await start($)
  expect(((await $.command.run({ command: 'pace', args: '' } as never)) as { text?: string }).text).toBe('Pace opened.')
  expect(panes.has('pace')).toBe(true)
  await $.command.run({ command: 'pace', args: '' } as never)
  expect(panes.has('pace')).toBe(false)
})

test('with no readings yet the panel says where they come from', async ($, on) => {
  world(on, [])
  await start($)
  await $.command.run({ command: 'pace', args: '' } as never)
  expect(await textOf(await panel($))).toMatch(/No reading yet: the limits mod shows one after the first reply\./)
})

// The footer as the engine asks the pace mod to draw it.
const RUNNING_OUT = [reading(24 * HOUR, 52, 70), reading(HOUR, 40, 74), reading(30 * 60_000, 52, 75), reading(0, 64, 76)]

test('in the terminal the footer has a blue-diamond P button after the limits: a press opens the panel, another closes it', async ($, on) => {
  const { panes } = world(on, [reading(HOUR, 30, 76), reading(0, 30, 76)])
  await start($)
  const footer = await $.ui.mount({ plugin: 'pace', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const p = await footer.find({ key: 'pace:p' })
  expect(p?.type).toBe('Button')
  expect(p?.props).toMatchObject({ label: '🔹P', plain: true, dimColor: true })
  await footer.press({ key: 'pace:p' })
  expect(panes.has('pace')).toBe(true)
  await footer.press({ key: 'pace:p' })
  expect(panes.has('pace')).toBe(false)
})

test('the desktop footer has no pace button (its slot is for the limits and timings); /pace opens the panel', async ($, on) => {
  world(on, [reading(HOUR, 30, 76), reading(0, 30, 76)])
  await start($)
  const footer = await $.ui.mount({ plugin: 'pace', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect(await footer.find({ key: 'pace:p' })).toBeUndefined()
})

test('P reads P! in the terminal while the pace would run a limit out before it resets', async ($, on) => {
  world(on, RUNNING_OUT)
  await start($)
  const terminal = await $.ui.mount({ plugin: 'pace', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect((await terminal.find({ key: 'pace:p' }))?.props).toMatchObject({ label: '🔹P!', dimColor: false })
})

test('right after a weekly reset, a point of rise in 70 minutes is no pace: no warning, no P!', async ($, on) => {
  const fresh = new Date(NOW + 7 * 24 * HOUR - 70 * 60_000).toISOString()
  const r = (agoMs: number, week: number) => ({ at: NOW - agoMs, five: { pct: 20, resetsAt: FIVE_RESET } as Win, week: { pct: week, resetsAt: fresh } as Win })
  const { toasts } = world(on, [r(70 * 60_000, 0), r(0, 1)])
  await start($)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [{ kind: 'seven_day', percentUsed: 1, resetsAt: fresh }], changed: ['rateLimits'] } as never)
  expect(toasts).toEqual([])
  const footer = await $.ui.mount({ plugin: 'pace', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.find({ key: 'pace:p' }))?.props.label).toBe('🔹P')
})
